#!/usr/bin/env python3
"""
community_monitor.py — ProxyRank.ai community signal monitor

Polls HN (Algolia), Reddit (JSON API), and X (Twitter API v2) for keywords
relevant to ProxyRank.ai. Drafts developer-friendly replies using Grok, then
routes them through Discord for human review before posting.

Schedule : every 3 hours
Platforms: Discord

Required .env:
    GROK_API_KEY
    DISCORD_BOT_TOKEN   — Discord routing
    DISCORD_CHANNEL_ID  — channel to send hits to (or DISCORD_CHANNEL_ID_HN/_REDDIT/_X)

Optional .env:
    X_BEARER_TOKEN      — enables X search (read-only)
    X_API_KEY           — OAuth1.0a for posting replies to X
    X_API_SECRET
    X_ACCESS_TOKEN
    X_ACCESS_SECRET
    DATA_DIR            — defaults to script directory

State files (in DATA_DIR):
    community_state.json          — seen post IDs (dedup)
    discord_sessions_state.json   — pending Discord approvals (survives restarts)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sys
import threading
import time
import urllib.parse
import uuid
from datetime import datetime
from pathlib import Path

import pytz
import requests
import schedule
import websocket
from dotenv import load_dotenv

# ── Config ─────────────────────────────────────────────────────────────────

load_dotenv()

GROK_API_KEY       = os.getenv("GROK_API_KEY", "")

DISCORD_BOT_TOKEN      = os.getenv("DISCORD_BOT_TOKEN", "")
DISCORD_CHANNEL_ID     = os.getenv("DISCORD_CHANNEL_ID", "")
DISCORD_CHANNEL_ID_HN     = os.getenv("DISCORD_CHANNEL_ID_HN", "")
DISCORD_CHANNEL_ID_REDDIT = os.getenv("DISCORD_CHANNEL_ID_REDDIT", "")
DISCORD_CHANNEL_ID_X      = os.getenv("DISCORD_CHANNEL_ID_X", "")
DISCORD_CHANNEL_ID_XPOST  = os.getenv("DISCORD_CHANNEL_ID_XPOST", "")  # X post proposals

# X: Bearer token for read — URL-decode in case it was pasted URL-encoded
X_BEARER_TOKEN  = urllib.parse.unquote(os.getenv("X_BEARER_TOKEN", ""))
X_API_KEY       = os.getenv("X_API_KEY", "")
X_API_SECRET    = os.getenv("X_API_SECRET", "")
X_ACCESS_TOKEN  = os.getenv("X_ACCESS_TOKEN", "")
X_ACCESS_SECRET = os.getenv("X_ACCESS_SECRET", "")

_data_env = os.getenv("DATA_DIR", "")
DATA_DIR  = Path(_data_env) if _data_env else Path(__file__).parent
CET       = pytz.timezone("Europe/Amsterdam")

# ── Keywords & sources ─────────────────────────────────────────────────────

# Primary keywords to search for
KEYWORDS = [
    "MCP",
    "ProxyRank",
    "Model Context Protocol",
    "AI agent",
    "CLI tool",
]

# If a hit's title+snippet contains any of these, skip it (false positive filter)
EXCLUDE_KEYWORDS = [
    "wildfire", "forest fire", "climate", "election", "war", "military",
    "killed", "attack", "hospital", "vaccine", "drug", "cancer",
    "children", "Gaza", "Jenin", "Ukraine", "Russia",
]

# Max hits sent per monitor run (prevents message overload)
MAX_HITS_PER_RUN = 5

SUBREDDITS = [
    "artificial",
    "MachineLearning",
    "AIagents",
    "OpenAI",
    "LocalLLaMA",
    "LocalAI",
    "Ollama",
    "MCP",
    "ModelContextProtocol",
]

# ── API endpoints ──────────────────────────────────────────────────────────

GROK_BASE_URL = "https://api.x.ai/v1/chat/completions"
GROK_MODEL    = "grok-3"

HN_SEARCH_URL = "https://hn.algolia.com/api/v1/search"
X_SEARCH_URL  = "https://api.twitter.com/2/tweets/search/recent"
X_POST_URL    = "https://api.twitter.com/2/tweets"

# ── State file paths ───────────────────────────────────────────────────────

COMMUNITY_STATE_PATH        = DATA_DIR / "community_state.json"
DISCORD_SESSION_STATE_PATH  = DATA_DIR / "discord_sessions_state.json"

# ── Atomic write ───────────────────────────────────────────────────────────

def _atomic_write_json(path: Path, data) -> None:
    """Write JSON atomically via tmp → rename to prevent corruption on restarts."""
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


# ── Community state (dedup) ────────────────────────────────────────────────

def _load_seen() -> set:
    if COMMUNITY_STATE_PATH.exists():
        try:
            data = json.loads(COMMUNITY_STATE_PATH.read_text(encoding="utf-8"))
            return set(data.get("seen", []))
        except Exception:
            pass
    return set()


def _save_seen(seen: set) -> None:
    _atomic_write_json(COMMUNITY_STATE_PATH, {"seen": sorted(seen)})


# ── Source: Hacker News (Algolia) ──────────────────────────────────────────

def _fetch_hn(seen: set) -> list:
    """Search HN stories posted in the last 4 hours for each keyword."""
    hits = []
    cutoff = int(time.time()) - 4 * 3600
    for kw in KEYWORDS:
        try:
            resp = requests.get(
                HN_SEARCH_URL,
                params={
                    "query":          kw,
                    "tags":           "story",
                    "hitsPerPage":    10,
                    "numericFilters": f"created_at_i>{cutoff}",
                },
                timeout=15,
            )
            resp.raise_for_status()
            for hit in resp.json().get("hits", []):
                uid = f"hn:{hit['objectID']}"
                if uid in seen:
                    continue
                seen.add(uid)
                hits.append({
                    "uid":      uid,
                    "source":   "hn",
                    "title":    hit.get("title") or hit.get("story_title") or "(no title)",
                    "url":      hit.get("url") or f"https://news.ycombinator.com/item?id={hit['objectID']}",
                    "hn_id":    hit["objectID"],
                    "snippet":  (hit.get("story_text") or "")[:400],
                    "keyword":  kw,
                    "points":   hit.get("points") or 0,
                    "comments": hit.get("num_comments") or 0,
                })
        except Exception as e:
            print(f"⚠️  HN fetch error ({kw!r}): {e}")
    return hits


# ── Source: Reddit (public JSON API, read-only) ────────────────────────────

def _fetch_reddit(seen: set) -> list:
    """Search each subreddit for each keyword using the public search JSON API."""
    hits = []
    headers = {"User-Agent": "ProxyRankMonitor/1.0"}
    for sub in SUBREDDITS:
        for kw in KEYWORDS:
            try:
                resp = requests.get(
                    f"https://www.reddit.com/r/{sub}/search.json",
                    params={"q": kw, "sort": "new", "limit": 10, "restrict_sr": 1, "t": "day"},
                    headers=headers,
                    timeout=15,
                )
                if resp.status_code == 429:
                    time.sleep(3)
                    continue
                resp.raise_for_status()
                for child in resp.json().get("data", {}).get("children", []):
                    post = child["data"]
                    uid  = f"reddit:{post['id']}"
                    if uid in seen:
                        continue
                    seen.add(uid)
                    hits.append({
                        "uid":       uid,
                        "source":    "reddit",
                        "subreddit": sub,
                        "title":     post.get("title", "(no title)"),
                        "url":       f"https://reddit.com{post.get('permalink', '')}",
                        "reddit_id": post["id"],
                        "snippet":   (post.get("selftext") or "")[:400],
                        "keyword":   kw,
                    })
                time.sleep(0.6)  # respect Reddit rate limits
            except Exception as e:
                print(f"⚠️  Reddit fetch error (r/{sub}, {kw!r}): {e}")
    return hits


# ── Source: X / Twitter (API v2, Bearer token for search) ─────────────────

def _fetch_x(seen: set) -> list:
    """Search recent tweets for each keyword using Twitter API v2."""
    if not X_BEARER_TOKEN:
        return []
    hits    = []
    headers = {"Authorization": f"Bearer {X_BEARER_TOKEN}"}
    for kw in KEYWORDS:
        try:
            resp = requests.get(
                X_SEARCH_URL,
                params={
                    "query":        f'"{kw}" -is:retweet lang:en',
                    "max_results":  10,
                    "tweet.fields": "author_id,created_at,text",
                    "expansions":   "author_id",
                    "user.fields":  "username",
                },
                headers=headers,
                timeout=15,
            )
            if resp.status_code == 429:
                print(f"⚠️  X rate limit on {kw!r} — skipping")
                continue
            resp.raise_for_status()
            data  = resp.json()
            users = {u["id"]: u["username"]
                     for u in data.get("includes", {}).get("users", [])}
            for tweet in data.get("data", []):
                uid      = f"x:{tweet['id']}"
                if uid in seen:
                    continue
                seen.add(uid)
                username = users.get(tweet.get("author_id", ""), "unknown")
                hits.append({
                    "uid":      uid,
                    "source":   "x",
                    "title":    f"@{username}: {tweet['text'][:80]}",
                    "url":      f"https://twitter.com/{username}/status/{tweet['id']}",
                    "tweet_id": tweet["id"],
                    "snippet":  tweet["text"][:400],
                    "keyword":  kw,
                })
        except Exception as e:
            print(f"⚠️  X fetch error ({kw!r}): {e}")
    return hits


# ── Grok API ───────────────────────────────────────────────────────────────

def _call_grok(system: str, user: str,
               temperature: float = 0.7, max_tokens: int = 300) -> str:
    if not GROK_API_KEY:
        print("⚠️  GROK_API_KEY not set")
        return ""
    headers = {
        "Authorization": f"Bearer {GROK_API_KEY}",
        "Content-Type":  "application/json",
    }
    payload = {
        "model":       GROK_MODEL,
        "messages":    [
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
        "temperature": temperature,
        "max_tokens":  max_tokens,
    }
    delays = (5, 15, 45)
    for attempt, delay in enumerate((*delays, None)):
        try:
            resp = requests.post(GROK_BASE_URL, headers=headers,
                                 json=payload, timeout=30)
        except Exception as e:
            print(f"❌ Grok request error: {e}")
            return ""
        if resp.status_code in (429, 503) and delay is not None:
            print(f"⏳ Grok rate limit ({resp.status_code}) — retrying in {delay}s "
                  f"(attempt {attempt + 1}/{len(delays)})")
            time.sleep(delay)
            continue
        try:
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"].strip()
        except Exception as e:
            print(f"❌ Grok parse error: {e}")
            return ""
    print("❌ Grok: max retries exceeded")
    return ""


def draft_reply(hit: dict) -> str:
    """Ask Grok to draft a 2-3 sentence developer-to-developer reply for this hit."""
    source_label = {
        "hn":     "Hacker News",
        "reddit": f"r/{hit.get('subreddit', 'reddit')}",
        "x":      "Twitter/X",
    }.get(hit["source"], hit["source"])

    system = (
        "You are a real developer who has been building with MCP servers, AI agents, and CLI tools "
        "for the past couple of years. You reply to posts on HN, Reddit, and Twitter/X from your own "
        "genuine experience — not as a marketer or bot.\n\n"
        "Rules for sounding human:\n"
        "- Write like you're typing fast, not composing an essay. Vary sentence length.\n"
        "- Draw on a specific personal experience, opinion, or tradeoff you've actually faced.\n"
        "- Use contractions (don't, I've, it's, you'd).\n"
        "- Be slightly opinionated — real devs have takes.\n"
        "- Reference concrete details from the post itself, not generic platitudes.\n"
        "- One natural follow-up question max, only if it adds value.\n"
        "- Do NOT start with 'Hey', 'Great', 'Interesting', 'I', or a compliment.\n"
        "- Do NOT ask about scalability, caching, or edge cases generically.\n"
        "- No emojis, no bullet points, no self-promotion.\n"
        "- Keep it 2–3 sentences. Shorter is more human.\n"
        "- Only mention ProxyRank.ai if it's directly relevant and would genuinely help them."
    )
    user = (
        f"Platform: {source_label}\n"
        f"Post title: {hit['title']}\n"
        f"Keyword match: {hit['keyword']}\n"
        f"Content snippet: {hit['snippet']}\n\n"
        "Write a reply that could pass as a real developer who's been in the weeds on this topic:"
    )
    return _call_grok(system, user)


def draft_x_post(hit: dict, community_reply: str) -> str:
    """Generate a standalone X (Twitter) post based on a community hit + drafted reply."""
    system = (
        "You write punchy X (Twitter) posts for ProxyRank.ai — a tool that monitors and ranks "
        "MCP server reliability. The posts sound like a real developer sharing an insight, "
        "not marketing copy.\n\n"
        "Rules:\n"
        "- Max 260 characters.\n"
        "- One concrete insight or take, grounded in the post topic.\n"
        "- Mention ProxyRank or proxyrank.ai naturally — not forced.\n"
        "- No hashtag spam (1 max). No emojis unless they add something.\n"
        "- Hook in the first line. Make it shareable.\n"
        "- Do NOT start with 'Excited to', 'Thrilled', 'Just launched'."
    )
    user = (
        f"Post topic: {hit['title']}\n"
        f"Community reply we drafted: {community_reply}\n\n"
        "Write a standalone X post (not a reply) that distils the key insight for our audience:"
    )
    return _call_grok(system, user, max_tokens=120)


# ── X OAuth1.0a signing (for posting replies) ──────────────────────────────

def _x_oauth1_header(method: str, url: str) -> str | None:
    """
    Build an OAuth1.0a Authorization header for X API v2 JSON requests.
    Requires X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET in .env.
    """
    if not all([X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET]):
        return None

    _q = lambda s: urllib.parse.quote(str(s), safe="")
    oauth = {
        "oauth_consumer_key":     X_API_KEY,
        "oauth_nonce":            uuid.uuid4().hex,
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp":        str(int(time.time())),
        "oauth_token":            X_ACCESS_TOKEN,
        "oauth_version":          "1.0",
    }
    # For JSON body requests, only OAuth params go into the signature base string
    param_str = "&".join(f"{_q(k)}={_q(v)}" for k, v in sorted(oauth.items()))
    base_str  = f"{method}&{_q(url)}&{_q(param_str)}"
    sign_key  = f"{_q(X_API_SECRET)}&{_q(X_ACCESS_SECRET)}"
    sig = base64.b64encode(
        hmac.new(sign_key.encode(), base_str.encode(), hashlib.sha1).digest()
    ).decode()
    oauth["oauth_signature"] = sig
    return "OAuth " + ", ".join(
        f'{_q(k)}="{_q(v)}"' for k, v in sorted(oauth.items())
    )


def _post_reply_x(tweet_id: str, reply_text: str) -> bool:
    """Post a reply to a tweet via Twitter API v2. Returns True on success."""
    auth = _x_oauth1_header("POST", X_POST_URL)
    if not auth:
        return False
    try:
        resp = requests.post(
            X_POST_URL,
            headers={"Authorization": auth, "Content-Type": "application/json"},
            json={"text": reply_text, "reply": {"in_reply_to_tweet_id": tweet_id}},
            timeout=15,
        )
        resp.raise_for_status()
        return True
    except Exception as e:
        print(f"❌ X reply post error: {e}")
        return False


def _post_tweet_x(text: str) -> bool:
    """Post a standalone tweet via Twitter API v2. Returns True on success."""
    auth = _x_oauth1_header("POST", X_POST_URL)
    if not auth:
        return False
    try:
        resp = requests.post(
            X_POST_URL,
            headers={"Authorization": auth, "Content-Type": "application/json"},
            json={"text": text},
            timeout=15,
        )
        resp.raise_for_status()
        return True
    except Exception as e:
        print(f"❌ X tweet post error: {e}")
        return False


# ── Discord Gateway (WebSocket — receives button/modal interactions) ────────

class DiscordGateway:
    """
    Minimal Discord Gateway client.
    Connects via WebSocket, heartbeats, and dispatches INTERACTION_CREATE events
    to the provided callback so button clicks and modal submits work.
    """
    GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json"

    def __init__(self, token: str, on_interaction) -> None:
        self._token          = token
        self._on_interaction = on_interaction
        self._sequence: int | None = None
        self._hb_interval: float   = 41.25  # seconds; overridden by HELLO
        self._ws: websocket.WebSocketApp | None = None

    def start(self) -> None:
        """Connect and run forever (call in a daemon thread)."""
        while True:
            try:
                self._ws = websocket.WebSocketApp(
                    self.GATEWAY_URL,
                    on_open    = self._on_open,
                    on_message = self._on_message,
                    on_error   = lambda ws, e: print(f"⚠️  Gateway error: {e}"),
                    on_close   = lambda ws, c, m: print("🔌 Gateway closed — reconnecting…"),
                )
                self._ws.run_forever(ping_interval=0)
            except Exception as e:
                print(f"⚠️  Gateway exception: {e}")
            time.sleep(5)  # brief pause before reconnect

    def _on_open(self, ws) -> None:
        print("🔗 Gateway connected")

    def _on_message(self, ws, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except Exception:
            return

        op = msg.get("op")
        t  = msg.get("t")
        d  = msg.get("d") or {}
        s  = msg.get("s")

        if s is not None:
            self._sequence = s

        if op == 10:  # HELLO — start heartbeating + identify
            self._hb_interval = d.get("heartbeat_interval", 41250) / 1000
            threading.Thread(target=self._heartbeat, args=(ws,), daemon=True).start()
            ws.send(json.dumps({
                "op": 2,
                "d": {
                    "token":      self._token,
                    "intents":    0,
                    "properties": {"os": "linux", "browser": "monitor", "device": "monitor"},
                },
            }))

        elif op == 1:  # Server requests heartbeat immediately
            ws.send(json.dumps({"op": 1, "d": self._sequence}))

        elif op == 0 and t == "READY":
            print("✅ Gateway ready")

        elif op == 0 and t == "INTERACTION_CREATE":
            try:
                self._on_interaction(d)
            except Exception as e:
                print(f"⚠️  Interaction handler error: {e}")

    def _heartbeat(self, ws) -> None:
        while True:
            time.sleep(self._hb_interval)
            try:
                ws.send(json.dumps({"op": 1, "d": self._sequence}))
            except Exception:
                break


# ── Discord bot ────────────────────────────────────────────────────────────

class DiscordBot:
    """
    Posts hits to Discord channels with interactive buttons.
    Buttons: Send · Tweak (modal) · Create X Post · Reject
    X Post channel gets its own Approve / Reject buttons.
    Interactions are received via the Gateway WebSocket.
    """

    DISCORD_API = "https://discord.com/api/v10"

    def __init__(self, token: str, channel_id: str,
                 channel_map: dict | None = None,
                 xpost_channel_id: str = "") -> None:
        self._token            = token
        self._channel_id       = channel_id          # default/fallback channel
        self._channel_map      = channel_map or {}   # source → channel_id
        self._xpost_channel_id = xpost_channel_id    # X post proposals channel
        self._headers          = {
            "Authorization": f"Bot {token}",
            "Content-Type":  "application/json",
        }
        self._pending: dict      = {}  # draft_msg_id → hit+draft session
        self._xpost_pending: dict = {}  # xpost_msg_id → {draft, hit}
        self._load()

    def _save(self) -> None:
        _atomic_write_json(DISCORD_SESSION_STATE_PATH, self._pending)

    def _load(self) -> None:
        if DISCORD_SESSION_STATE_PATH.exists():
            try:
                data = json.loads(DISCORD_SESSION_STATE_PATH.read_text(encoding="utf-8"))
                self._pending = data
                if data:
                    print(f"♻️  Discord: restored {len(data)} pending session(s) from disk.")
            except Exception:
                pass

    def _api(self, method: str, path: str, **kwargs) -> dict | list:
        url = f"{self.DISCORD_API}{path}"
        try:
            resp = requests.request(method, url, headers=self._headers,
                                    timeout=10, **kwargs)
            if resp.status_code == 429:
                retry_after = resp.json().get("retry_after", 1)
                time.sleep(float(retry_after))
                return {}
            resp.raise_for_status()
            return resp.json() if resp.text else {}
        except Exception as e:
            print(f"⚠️  Discord API error ({method} {path}): {e}")
            return {}

    def _send(self, content: str, reply_to: str | None = None,
              channel_id: str | None = None) -> str:
        """Post a message; returns the new message ID or empty string."""
        ch = channel_id or self._channel_id
        payload: dict = {"content": content}
        if reply_to:
            payload["message_reference"] = {"message_id": reply_to}
        result = self._api("POST", f"/channels/{ch}/messages", json=payload)
        return result.get("id", "") if isinstance(result, dict) else ""

    # ── Send a new hit ────────────────────────────────────────────────────

    def send_hit(self, hit: dict, draft: str) -> None:
        # Route to per-source channel if configured, else fall back to default
        channel_id   = self._channel_map.get(hit["source"], self._channel_id)
        source_icon  = {"hn": "🔶", "reddit": "🟠", "x": "🐦"}.get(hit["source"], "📡")
        source_label = {
            "hn":     "Hacker News",
            "reddit": f"r/{hit.get('subreddit', 'reddit')}",
            "x":      "Twitter/X",
        }.get(hit["source"], hit["source"])

        # For HN, show both the article URL and the comment thread URL
        if hit["source"] == "hn":
            hn_thread = f"https://news.ycombinator.com/item?id={hit.get('hn_id', '')}"
            links = f"{hit['url']}\n💬 Post reply here → {hn_thread}"
        elif hit["source"] == "reddit":
            links = f"Post reply here → {hit['url']}"
        else:
            links = hit["url"]

        card = (
            f"{source_icon} **{source_label}**  ·  `{hit['keyword']}`\n"
            f"**{hit['title']}**\n"
            f"{links}"
        )
        card_id = self._send(card, channel_id=channel_id)
        if not card_id:
            return

        # Build buttons — placeholder msg_id filled in after we know it
        # We send the draft first without buttons, get its ID, then edit to add buttons
        msg_id = self._send(draft, reply_to=card_id, channel_id=channel_id)
        if not msg_id:
            return

        # Edit the draft message to attach action buttons
        xpost_btn = []
        if self._xpost_channel_id:
            xpost_btn = [{"type": 2, "style": 2, "label": "📢 Create X Post",
                          "custom_id": f"xpost:{msg_id}"}]
        buttons = {
            "components": [{
                "type": 1,
                "components": [
                    {"type": 2, "style": 3, "label": "✅ Send",   "custom_id": f"send:{msg_id}"},
                    {"type": 2, "style": 2, "label": "✏️ Tweak",  "custom_id": f"tweak:{msg_id}"},
                    *xpost_btn,
                    {"type": 2, "style": 4, "label": "❌ Reject", "custom_id": f"reject:{msg_id}"},
                ],
            }]
        }
        self._api("PATCH", f"/channels/{channel_id}/messages/{msg_id}", json=buttons)

        self._pending[msg_id] = {**hit, "draft": draft}
        self._save()
        print(f"💬 Discord: sent [{hit['source']}] → #{channel_id} — {hit['title'][:55]}")

    # ── Poll for replies ──────────────────────────────────────────────────

    def poll(self) -> None:
        """Long-poll all configured Discord channels for new messages."""
        all_channels = list({self._channel_id} | set(self._channel_map.values()) - {""})
        print(f"📡 Discord poll started — watching {len(all_channels)} channel(s)")

        # Seed per-channel cursor so we don't replay old messages on startup
        last_ids: dict[str, str] = {}
        for ch in all_channels:
            msgs = self._api("GET", f"/channels/{ch}/messages", params={"limit": 1})
            last_ids[ch] = msgs[0]["id"] if isinstance(msgs, list) and msgs else "0"

        while True:
            try:
                for ch in all_channels:
                    msgs = self._api("GET", f"/channels/{ch}/messages",
                                     params={"after": last_ids[ch], "limit": 100})
                    if isinstance(msgs, list):
                        for msg in reversed(msgs):   # oldest first
                            last_ids[ch] = msg["id"]
                            self._handle_message(msg)
            except Exception as e:
                print(f"⚠️  Discord poll error: {e}")
            time.sleep(3)

    # ── Interaction (button / modal) handler ─────────────────────────────

    def handle_interaction(self, data: dict) -> None:
        """Called by DiscordGateway for every INTERACTION_CREATE event."""
        itype     = data.get("type")         # 3 = component, 5 = modal submit
        iid       = data.get("id", "")
        token     = data.get("token", "")
        cdata     = data.get("data", {})
        custom_id = cdata.get("custom_id", "")

        if itype == 3:  # Message component (button)
            action, _, session_key = custom_id.partition(":")
            if action == "send":
                self._ack_interaction(iid, token)
                session = self._pending.get(session_key)
                if session:
                    threading.Thread(
                        target=self._do_post_interaction,
                        args=(session_key, session),
                        daemon=True,
                    ).start()

            elif action == "reject":
                self._ack_interaction(iid, token, content="❌ Rejected.")
                self._pending.pop(session_key, None)
                self._save()

            elif action == "tweak":
                # Open a modal with a text input for the instruction
                self._respond_interaction(iid, token, {
                    "type": 9,  # MODAL
                    "data": {
                        "title":      "Tweak instruction",
                        "custom_id":  f"tweak_modal:{session_key}",
                        "components": [{
                            "type": 1,
                            "components": [{
                                "type":        4,
                                "custom_id":   "instruction",
                                "label":       "Instruction",
                                "style":       2,
                                "placeholder": "e.g. make it sharper, add ProxyRank mention",
                                "required":    True,
                            }],
                        }],
                    },
                })

            elif action == "xpost":
                self._ack_interaction(iid, token, content="📢 Generating X post…")
                session = self._pending.get(session_key)
                if session:
                    threading.Thread(
                        target=self._create_xpost,
                        args=(session,),
                        daemon=True,
                    ).start()

            elif action == "xpost_approve":
                self._ack_interaction(iid, token)
                xp = self._xpost_pending.get(session_key)
                if xp:
                    threading.Thread(
                        target=self._post_x_tweet,
                        args=(session_key, xp),
                        daemon=True,
                    ).start()

            elif action == "xpost_reject":
                self._ack_interaction(iid, token, content="❌ X post rejected.")
                self._xpost_pending.pop(session_key, None)

        elif itype == 5:  # Modal submit
            action, _, session_key = custom_id.partition(":")
            if action == "tweak_modal":
                instruction = ""
                for row in cdata.get("components", []):
                    for comp in row.get("components", []):
                        if comp.get("custom_id") == "instruction":
                            instruction = comp.get("value", "").strip()
                if instruction:
                    self._ack_interaction(iid, token, content="✍️ Rewriting…")
                    session = self._pending.get(session_key)
                    if session:
                        threading.Thread(
                            target=self._do_tweak,
                            args=(session_key, session, instruction),
                            daemon=True,
                        ).start()

    def _ack_interaction(self, iid: str, token: str, content: str | None = None) -> None:
        """Acknowledge an interaction (required within 3 s)."""
        if content:
            body = {"type": 4, "data": {"content": content, "flags": 64}}  # ephemeral
        else:
            body = {"type": 6}  # deferred update (no visible change)
        try:
            requests.post(
                f"{self.DISCORD_API}/interactions/{iid}/{token}/callback",
                json=body, timeout=3,
            )
        except Exception as e:
            print(f"⚠️  Interaction ack failed: {e}")

    def _respond_interaction(self, iid: str, token: str, body: dict) -> None:
        try:
            requests.post(
                f"{self.DISCORD_API}/interactions/{iid}/{token}/callback",
                json=body, timeout=3,
            )
        except Exception as e:
            print(f"⚠️  Interaction respond failed: {e}")

    def _do_post_interaction(self, session_key: str, session: dict) -> None:
        source = session["source"]
        draft  = session["draft"]
        url    = session["url"]
        ch     = self._channel_map.get(source, self._channel_id)

        if source == "x":
            tweet_id = session.get("tweet_id", "")
            if all([X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET]):
                ok = _post_reply_x(tweet_id, draft)
                msg = f"✅ Reply posted to X!\n{url}" if ok else \
                      f"❌ X post failed — copy manually:\n```\n{draft}\n```\n{url}"
            else:
                msg = f"📋 **Post on X:**\n```\n{draft}\n```\n{url}"
        elif source == "reddit":
            msg = f"📋 **Post on Reddit:**\n```\n{draft}\n```\n{url}"
        else:
            hn_url = f"https://news.ycombinator.com/item?id={session.get('hn_id', '')}"
            msg = f"📋 **Post on HN:**\n```\n{draft}\n```\n{hn_url}"

        self._send(msg, channel_id=ch)
        self._pending.pop(session_key, None)
        self._save()

    def _do_tweak(self, session_key: str, session: dict, instruction: str) -> None:
        system = (
            "You are a developer replying to posts on HN, Reddit, and Twitter/X. "
            "Rewrite the draft reply according to the user's instruction. "
            "Keep it 2–3 sentences, developer-to-developer, no emojis, no self-promotion."
        )
        user_prompt = (
            f"Original draft:\n{session['draft']}\n\n"
            f"Instruction: {instruction}\n\nRewritten reply:"
        )
        new_draft = _call_grok(system, user_prompt)
        if not new_draft:
            return
        session["draft"] = new_draft
        self._save()

        source = session["source"]
        ch     = self._channel_map.get(source, self._channel_id)
        source_icon = {"hn": "🔶", "reddit": "🟠", "x": "🐦"}.get(source, "📡")
        note_id = self._send(f"{source_icon} **Revised draft:**", channel_id=ch)
        new_msg_id = self._send(new_draft, reply_to=note_id, channel_id=ch) if note_id \
                     else self._send(new_draft, channel_id=ch)
        if new_msg_id:
            xpost_btn = []
            if self._xpost_channel_id:
                xpost_btn = [{"type": 2, "style": 2, "label": "📢 Create X Post",
                              "custom_id": f"xpost:{new_msg_id}"}]
            self._api("PATCH", f"/channels/{ch}/messages/{new_msg_id}", json={
                "components": [{
                    "type": 1,
                    "components": [
                        {"type": 2, "style": 3, "label": "✅ Send",   "custom_id": f"send:{new_msg_id}"},
                        {"type": 2, "style": 2, "label": "✏️ Tweak",  "custom_id": f"tweak:{new_msg_id}"},
                        *xpost_btn,
                        {"type": 2, "style": 4, "label": "❌ Reject", "custom_id": f"reject:{new_msg_id}"},
                    ],
                }]
            })
            self._pending[new_msg_id] = session
            self._save()

    def _create_xpost(self, session: dict) -> None:
        if not self._xpost_channel_id:
            return
        x_draft = draft_x_post(session, session["draft"])
        if not x_draft:
            return
        msg_id = self._send(x_draft, channel_id=self._xpost_channel_id)
        if not msg_id:
            return
        self._api("PATCH", f"/channels/{self._xpost_channel_id}/messages/{msg_id}", json={
            "components": [{
                "type": 1,
                "components": [
                    {"type": 2, "style": 3, "label": "✅ Approve & Post",
                     "custom_id": f"xpost_approve:{msg_id}"},
                    {"type": 2, "style": 4, "label": "❌ Reject",
                     "custom_id": f"xpost_reject:{msg_id}"},
                ],
            }]
        })
        self._xpost_pending[msg_id] = {"draft": x_draft, "hit": session}
        print(f"📢 X post proposal sent → #{self._xpost_channel_id}")

    def _post_x_tweet(self, session_key: str, xp: dict) -> None:
        draft = xp["draft"]
        if all([X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET]):
            ok = _post_tweet_x(draft)
            msg = f"✅ Posted to X!\n\n{draft}" if ok else \
                  f"❌ Post failed — copy manually:\n```\n{draft}\n```"
        else:
            msg = f"📋 **Post this on X:**\n```\n{draft}\n```"
        self._send(msg, channel_id=self._xpost_channel_id)
        self._xpost_pending.pop(session_key, None)

    def _handle_message(self, msg: dict) -> None:
        ref       = msg.get("message_reference", {})
        parent_id = ref.get("message_id")
        if not parent_id or parent_id not in self._pending:
            return

        ch      = msg.get("channel_id", self._channel_id)
        text    = msg.get("content", "").strip()
        cmd     = text.lower().split(":")[0].strip()
        session = self._pending[parent_id]

        if cmd == "skip":
            self._pending.pop(parent_id, None)
            self._save()
            self._send("⏭️ Skipped.", reply_to=msg["id"], channel_id=ch)

        elif cmd == "send":
            self._do_post(parent_id, session, msg["id"], ch)

        elif cmd == "tweak":
            instruction = text[text.index(":") + 1:].strip() if ":" in text else ""
            if not instruction:
                self._send("Usage: `tweak: your instruction here`",
                           reply_to=msg["id"], channel_id=ch)
                return
            self._send("✍️ Rewriting…", reply_to=msg["id"], channel_id=ch)
            system = (
                "You are a developer replying to posts on HN, Reddit, and Twitter/X. "
                "Rewrite the draft reply according to the user's instruction. "
                "Keep it 2–3 sentences, developer-to-developer, no emojis, no self-promotion."
            )
            user_prompt = (
                f"Original draft:\n{session['draft']}\n\n"
                f"Instruction: {instruction}\n\n"
                "Rewritten reply:"
            )
            new_draft = _call_grok(system, user_prompt)
            if not new_draft:
                self._send("❌ Couldn't rewrite. Try again.",
                           reply_to=msg["id"], channel_id=ch)
                return
            session["draft"] = new_draft
            self._save()
            source_icon = {"hn": "🔶", "reddit": "🟠", "x": "🐦"}.get(session["source"], "📡")
            note_id = self._send(
                f"{source_icon} **Revised reply** — long-press the text below to copy:",
                reply_to=msg["id"], channel_id=ch,
            )
            new_msg_id = (self._send(new_draft, reply_to=note_id, channel_id=ch)
                          if note_id else self._send(new_draft, channel_id=ch))
            if new_msg_id:
                self._pending[new_msg_id] = session
                self._save()

    def _do_post(self, parent_id: str, session: dict,
                 reply_to_id: str, channel_id: str | None = None) -> None:
        ch     = channel_id or self._channel_id
        source = session["source"]
        draft  = session["draft"]
        url    = session["url"]

        if source == "x":
            tweet_id = session.get("tweet_id", "")
            if all([X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET]):
                ok = _post_reply_x(tweet_id, draft)
                if ok:
                    self._send(f"✅ Reply posted to X!\n{url}",
                               reply_to=reply_to_id, channel_id=ch)
                else:
                    self._send(
                        f"❌ X post failed — copy manually:\n```\n{draft}\n```\n{url}",
                        reply_to=reply_to_id, channel_id=ch,
                    )
            else:
                self._send(
                    f"📋 **Post on X:**\n```\n{draft}\n```\n{url}",
                    reply_to=reply_to_id, channel_id=ch,
                )
        elif source == "reddit":
            self._send(
                f"📋 **Post on Reddit:**\n```\n{draft}\n```\n{url}",
                reply_to=reply_to_id, channel_id=ch,
            )
        elif source == "hn":
            hn_comment_url = f"https://news.ycombinator.com/item?id={session.get('hn_id', '')}"
            self._send(
                f"📋 **Post on HN:**\n```\n{draft}\n```\n{hn_comment_url}",
                reply_to=reply_to_id, channel_id=ch,
            )

        self._pending.pop(parent_id, None)
        self._save()


# ── Monitor job ────────────────────────────────────────────────────────────

_discord_bot: DiscordBot | None = None


def run_monitor(test: bool = False) -> None:
    global _discord_bot
    now = datetime.now(CET).strftime("%Y-%m-%d %H:%M CET")
    print(f"\n🔍 Monitor run{'  [TEST — dedup bypassed]' if test else ''} — {now}")

    seen     = set() if test else _load_seen()
    all_hits = []

    print("  → HN ...")
    all_hits += _fetch_hn(seen)

    print("  → Reddit ...")
    all_hits += _fetch_reddit(seen)

    if X_BEARER_TOKEN:
        print("  → X ...")
        all_hits += _fetch_x(seen)
    else:
        print("  → X skipped (no X_BEARER_TOKEN)")

    if not test:
        _save_seen(seen)
    print(f"  {len(all_hits)} new hit(s) found")

    # Filter: keyword must appear in title, and title must not contain off-topic terms
    def _is_relevant(hit: dict) -> bool:
        title   = hit.get("title", "").lower()
        snippet = hit.get("snippet", "").lower()
        keyword = hit.get("keyword", "").lower()
        if keyword not in title:
            return False
        return not any(kw.lower() in title + " " + snippet for kw in EXCLUDE_KEYWORDS)

    relevant = [h for h in all_hits if _is_relevant(h)]
    skipped  = len(all_hits) - len(relevant)
    if skipped:
        print(f"  {skipped} hit(s) filtered (off-topic or keyword not in title)")

    # Deduplicate by title within the run (same story on HN + Reddit looks like a duplicate)
    seen_titles: set[str] = set()
    deduped: list = []
    for hit in relevant:
        norm = hit["title"].lower()[:80]
        if norm not in seen_titles:
            seen_titles.add(norm)
            deduped.append(hit)
    if len(deduped) < len(relevant):
        print(f"  {len(relevant) - len(deduped)} duplicate title(s) dropped")
    relevant = deduped

    # Cap to avoid overloading the review queue
    relevant = relevant[:MAX_HITS_PER_RUN]
    print(f"  Sending {len(relevant)} hit(s) (cap: {MAX_HITS_PER_RUN}/run)")

    if not relevant:
        return

    for hit in relevant:
        draft = draft_reply(hit)
        if not draft:
            continue
        if _discord_bot is not None:
            _discord_bot.send_hit(hit, draft)
            time.sleep(0.5)


# ── Entry point ────────────────────────────────────────────────────────────

def main() -> None:
    global _discord_bot

    test = "--test" in sys.argv

    if not GROK_API_KEY:
        print("❌ Missing required env var: GROK_API_KEY")
        sys.exit(1)

    discord_channel_map: dict[str, str] = {}
    if DISCORD_CHANNEL_ID_HN:
        discord_channel_map["hn"] = DISCORD_CHANNEL_ID_HN
    if DISCORD_CHANNEL_ID_REDDIT:
        discord_channel_map["reddit"] = DISCORD_CHANNEL_ID_REDDIT
    if DISCORD_CHANNEL_ID_X:
        discord_channel_map["x"] = DISCORD_CHANNEL_ID_X

    has_discord = bool(DISCORD_BOT_TOKEN and (DISCORD_CHANNEL_ID or discord_channel_map))
    if not has_discord:
        print("❌ No notification channel configured — set DISCORD_BOT_TOKEN + DISCORD_CHANNEL_ID in .env")
        sys.exit(1)

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if has_discord:
        _discord_bot = DiscordBot(
            DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID,
            channel_map=discord_channel_map,
            xpost_channel_id=DISCORD_CHANNEL_ID_XPOST,
        )
        threading.Thread(target=_discord_bot.poll, daemon=True, name="discord-poll").start()
        routed = ", ".join(f"{s}→#{cid}" for s, cid in discord_channel_map.items()) or f"all→#{DISCORD_CHANNEL_ID}"
        print(f"💬 Discord routing enabled — {routed}")
        if DISCORD_CHANNEL_ID_XPOST:
            print(f"📢 X post proposals → #{DISCORD_CHANNEL_ID_XPOST}")

        # Start Gateway for button/modal interactions
        gateway = DiscordGateway(DISCORD_BOT_TOKEN, _discord_bot.handle_interaction)
        threading.Thread(target=gateway.start, daemon=True, name="discord-gateway").start()

    if test:
        print("🧪 Test mode — running once, dedup bypassed, then exiting.")
        run_monitor(test=True)
        time.sleep(3)  # allow Discord sends to complete
        return

    # Normal mode: run immediately then every 3 hours
    run_monitor()
    schedule.every(3).hours.do(run_monitor)

    print("\n⏰ Scheduler active — running every 3 hours. Ctrl+C to stop.\n")
    while True:
        schedule.run_pending()
        time.sleep(30)


if __name__ == "__main__":
    main()
