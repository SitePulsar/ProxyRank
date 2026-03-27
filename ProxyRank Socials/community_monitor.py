#!/usr/bin/env python3
"""
community_monitor.py — ProxyRank.ai community signal monitor

Polls HN (Algolia), Reddit (JSON API), and X (Twitter API v2) for keywords
relevant to ProxyRank.ai. Drafts developer-friendly replies using Grok, then
routes them through Telegram and/or Discord for human review before posting.

Schedule : every 3 hours
Platforms: Telegram (active), Discord (active)

Required .env:
    GROK_API_KEY
    TELEGRAM_BOT_TOKEN
    TELEGRAM_CHAT_ID

Optional .env:
    DISCORD_BOT_TOKEN   — enables Discord routing
    DISCORD_CHANNEL_ID  — channel to send hits to
    X_BEARER_TOKEN      — enables X search (read-only)
    X_API_KEY           — OAuth1.0a for posting replies to X
    X_API_SECRET
    X_ACCESS_TOKEN
    X_ACCESS_SECRET
    DATA_DIR            — defaults to script directory

State files (in DATA_DIR):
    community_state.json          — seen post IDs (dedup)
    community_sessions_state.json — pending Telegram approvals (survives restarts)
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
from dotenv import load_dotenv

# ── Config ─────────────────────────────────────────────────────────────────

load_dotenv()

GROK_API_KEY       = os.getenv("GROK_API_KEY", "")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN_COMMUNITY_MONITOR", "")
TELEGRAM_CHAT_ID   = os.getenv("TELEGRAM_CHAT_ID", "")

DISCORD_BOT_TOKEN  = os.getenv("DISCORD_BOT_TOKEN", "")
DISCORD_CHANNEL_ID = os.getenv("DISCORD_CHANNEL_ID", "")

# X: Bearer token for read; OAuth1.0a keys for posting replies
X_BEARER_TOKEN  = os.getenv("X_BEARER_TOKEN", "")
X_API_KEY       = os.getenv("X_API_KEY", "")
X_API_SECRET    = os.getenv("X_API_SECRET", "")
X_ACCESS_TOKEN  = os.getenv("X_ACCESS_TOKEN", "")
X_ACCESS_SECRET = os.getenv("X_ACCESS_SECRET", "")

_data_env = os.getenv("DATA_DIR", "")
DATA_DIR  = Path(_data_env) if _data_env else Path(__file__).parent
CET       = pytz.timezone("Europe/Amsterdam")

# ── Keywords & sources ─────────────────────────────────────────────────────

KEYWORDS = [
    "MCP",
    "ProxyRank",
    "Model Context Protocol",
    "AI agent",
    "CLI tool",
]

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

TELEGRAM_BASE = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"

HN_SEARCH_URL = "https://hn.algolia.com/api/v1/search"
X_SEARCH_URL  = "https://api.twitter.com/2/tweets/search/recent"
X_POST_URL    = "https://api.twitter.com/2/tweets"

# ── State file paths ───────────────────────────────────────────────────────

COMMUNITY_STATE_PATH = DATA_DIR / "community_state.json"
SESSION_STATE_PATH   = DATA_DIR / "community_sessions_state.json"

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


# ── Session state (pending Telegram approvals) ─────────────────────────────

def _load_sessions() -> dict:
    if SESSION_STATE_PATH.exists():
        try:
            return json.loads(SESSION_STATE_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _save_sessions(sessions: dict) -> None:
    _atomic_write_json(SESSION_STATE_PATH, sessions)


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
                    "uid":     uid,
                    "source":  "hn",
                    "title":   hit.get("title") or hit.get("story_title") or "(no title)",
                    "url":     hit.get("url") or f"https://news.ycombinator.com/item?id={hit['objectID']}",
                    "hn_id":   hit["objectID"],
                    "snippet": (hit.get("story_text") or "")[:400],
                    "keyword": kw,
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
        "You are a developer replying to posts on HN, Reddit, and Twitter/X. "
        "Write a 2–3 sentence reply that is genuinely helpful and developer-to-developer. "
        "Be direct and specific — no platitudes, no emojis, no self-promotion. "
        "Only mention ProxyRank.ai if it is directly and naturally relevant, never forced."
    )
    user = (
        f"Platform: {source_label}\n"
        f"Post title: {hit['title']}\n"
        f"Keyword match: {hit['keyword']}\n"
        f"Content snippet: {hit['snippet']}\n\n"
        "Draft a reply:"
    )
    return _call_grok(system, user)


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
        print(f"❌ X post error: {e}")
        return False


# ── Telegram bot ───────────────────────────────────────────────────────────

class CommunityBot:
    """
    Long-polls Telegram for button presses and free-text adjustments.
    Sends new hits with [✅ Stuur] [✍️ Aanpassen] [❌ Overslaan] inline buttons.
    Session state survives restarts via community_sessions_state.json.
    """

    def __init__(self) -> None:
        self._last_update_id: int  = 0
        self._pending: dict        = {}   # session_id → hit + draft + msg_id
        self._awaiting_tweak: dict = {}   # chat_id (str) → session_id
        self._load()

    # ── Persistence ──────────────────────────────────────────────────────

    def _save(self) -> None:
        _save_sessions(self._pending)

    def _load(self) -> None:
        data = _load_sessions()
        if data:
            self._pending = data
            print(f"♻️  Restored {len(data)} pending session(s) from disk.")

    # ── Telegram helpers ──────────────────────────────────────────────────

    def _tg(self, method: str, **kwargs) -> dict:
        try:
            r = requests.post(f"{TELEGRAM_BASE}/{method}", json=kwargs, timeout=10)
            result = r.json()
            if not result.get("ok"):
                print(f"⚠️  Telegram {method}: {result.get('description', result)}")
            return result
        except Exception as e:
            print(f"⚠️  Telegram error ({method}): {e}")
            return {}

    def _keyboard(self, session_id: str) -> dict:
        return {"inline_keyboard": [[
            {"text": "✅ Stuur",      "callback_data": f"cm_send_{session_id}"},
            {"text": "✍️ Aanpassen",  "callback_data": f"cm_tweak_{session_id}"},
            {"text": "❌ Overslaan",  "callback_data": f"cm_skip_{session_id}"},
        ]]}

    # ── Send a new hit ────────────────────────────────────────────────────

    def send_hit(self, hit: dict, draft: str) -> None:
        session_id   = uuid.uuid4().hex[:8]
        source_icon  = {"hn": "🔶", "reddit": "🟠", "x": "🐦"}.get(hit["source"], "📡")
        source_label = {
            "hn":     "Hacker News",
            "reddit": f"r/{hit.get('subreddit', 'reddit')}",
            "x":      "Twitter/X",
        }.get(hit["source"], hit["source"])

        text = (
            f"{source_icon} <b>{source_label}</b>  ·  <code>{hit['keyword']}</code>\n\n"
            f"<b>{hit['title']}</b>\n"
            f"<a href='{hit['url']}'>Bekijk post →</a>\n\n"
            f"💬 <b>Voorgesteld antwoord:</b>\n"
            f"<i>{draft}</i>"
        )
        result = self._tg(
            "sendMessage",
            chat_id=TELEGRAM_CHAT_ID,
            text=text,
            parse_mode="HTML",
            reply_markup=self._keyboard(session_id),
            disable_web_page_preview=True,
        )
        msg_id = result.get("result", {}).get("message_id")
        self._pending[session_id] = {**hit, "draft": draft, "msg_id": msg_id}
        self._save()
        print(f"📱 Sent [{hit['source']}] {hit['title'][:65]}")

    # ── Callback handler (button presses) ────────────────────────────────

    def _handle_callback(self, cq: dict) -> None:
        data   = cq.get("data", "")
        msg_id = cq["message"]["message_id"]
        chat_id = str(cq["message"]["chat"]["id"])

        self._tg("answerCallbackQuery", callback_query_id=cq["id"])

        if not data.startswith("cm_"):
            return

        parts = data.split("_", 2)   # ["cm", action, session_id]
        if len(parts) < 3:
            return
        action, session_id = parts[1], parts[2]

        if action == "skip":
            self._tg("editMessageReplyMarkup",
                     chat_id=TELEGRAM_CHAT_ID, message_id=msg_id,
                     reply_markup={"inline_keyboard": []})
            self._pending.pop(session_id, None)
            self._save()
            return

        session = self._pending.get(session_id)
        if not session:
            self._tg("editMessageReplyMarkup",
                     chat_id=TELEGRAM_CHAT_ID, message_id=msg_id,
                     reply_markup={"inline_keyboard": []})
            self._tg("sendMessage", chat_id=TELEGRAM_CHAT_ID,
                     text="⏱ Sessie verlopen.", parse_mode="HTML")
            return

        if action == "tweak":
            self._awaiting_tweak[chat_id] = session_id
            self._tg("sendMessage",
                     chat_id=TELEGRAM_CHAT_ID,
                     text=(
                         "✍️ Typ je aanpassing-instructie:\n"
                         "<i>(bijv: \"maak het korter\", \"voeg een vraag toe\", \"meer technisch\")</i>"
                     ),
                     parse_mode="HTML")
            return

        if action == "send":
            self._tg("editMessageReplyMarkup",
                     chat_id=TELEGRAM_CHAT_ID, message_id=msg_id,
                     reply_markup={"inline_keyboard": []})
            self._do_post(session_id, session)

    # ── Post to platform ──────────────────────────────────────────────────

    def _do_post(self, session_id: str, session: dict) -> None:
        source = session["source"]
        draft  = session["draft"]
        url    = session["url"]

        if source == "x":
            tweet_id = session.get("tweet_id", "")
            if all([X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET]):
                ok = _post_reply_x(tweet_id, draft)
                if ok:
                    self._tg("sendMessage", chat_id=TELEGRAM_CHAT_ID,
                             text=f"✅ Reply gepost op X!\n<a href='{url}'>Bekijk →</a>",
                             parse_mode="HTML", disable_web_page_preview=True)
                else:
                    self._tg("sendMessage", chat_id=TELEGRAM_CHAT_ID,
                             text=(
                                 f"❌ X post mislukt — kopieer handmatig:\n\n"
                                 f"<code>{draft}</code>\n\n"
                                 f"<a href='{url}'>Open tweet →</a>"
                             ),
                             parse_mode="HTML", disable_web_page_preview=True)
            else:
                self._tg("sendMessage", chat_id=TELEGRAM_CHAT_ID,
                         text=(
                             f"📋 <b>Kopieer en post op X:</b>\n\n"
                             f"<code>{draft}</code>\n\n"
                             f"<a href='{url}'>Open tweet →</a>"
                         ),
                         parse_mode="HTML", disable_web_page_preview=True)

        elif source == "reddit":
            self._tg("sendMessage", chat_id=TELEGRAM_CHAT_ID,
                     text=(
                         f"📋 <b>Kopieer en post op Reddit:</b>\n\n"
                         f"<code>{draft}</code>\n\n"
                         f"<a href='{url}'>Open post →</a>"
                     ),
                     parse_mode="HTML", disable_web_page_preview=True)

        elif source == "hn":
            hn_comment_url = f"https://news.ycombinator.com/item?id={session.get('hn_id', '')}"
            self._tg("sendMessage", chat_id=TELEGRAM_CHAT_ID,
                     text=(
                         f"📋 <b>Kopieer en post op HN:</b>\n\n"
                         f"<code>{draft}</code>\n\n"
                         f"<a href='{hn_comment_url}'>Open comment thread →</a>"
                     ),
                     parse_mode="HTML", disable_web_page_preview=True)

        self._pending.pop(session_id, None)
        self._save()

    # ── Free-text handler (tweak instructions) ────────────────────────────

    def _handle_message(self, msg: dict) -> None:
        chat_id = str(msg["chat"]["id"])
        text    = msg.get("text", "").strip()

        if not text or chat_id not in self._awaiting_tweak:
            return

        session_id = self._awaiting_tweak.pop(chat_id)
        session    = self._pending.get(session_id)
        if not session:
            self._tg("sendMessage", chat_id=chat_id, text="⏱ Sessie verlopen.")
            return

        system = (
            "You are a developer replying to posts on HN, Reddit, and Twitter/X. "
            "Rewrite the draft reply according to the user's instruction. "
            "Keep it 2–3 sentences, developer-to-developer, no emojis, no self-promotion."
        )
        user_prompt = (
            f"Original draft:\n{session['draft']}\n\n"
            f"Instruction: {text}\n\n"
            "Rewritten reply:"
        )
        new_draft = _call_grok(system, user_prompt)
        if not new_draft:
            self._tg("sendMessage", chat_id=TELEGRAM_CHAT_ID,
                     text="❌ Grok kon het niet herschrijven. Typ opnieuw je instructie.")
            self._awaiting_tweak[chat_id] = session_id
            return

        session["draft"] = new_draft
        self._save()

        source_icon = {"hn": "🔶", "reddit": "🟠", "x": "🐦"}.get(session["source"], "📡")
        result = self._tg(
            "sendMessage",
            chat_id=TELEGRAM_CHAT_ID,
            text=f"{source_icon} <b>Herzien antwoord:</b>\n\n<i>{new_draft}</i>",
            parse_mode="HTML",
            reply_markup=self._keyboard(session_id),
        )
        msg_id = result.get("result", {}).get("message_id")
        if msg_id:
            session["msg_id"] = msg_id
        self._save()

    # ── Long-polling loop (runs in background thread) ─────────────────────

    def poll(self) -> None:
        """Long-poll Telegram getUpdates. Runs forever in a daemon thread."""
        print("📡 Telegram long-poll started")
        while True:
            try:
                result = self._tg(
                    "getUpdates",
                    offset=self._last_update_id + 1,
                    timeout=30,
                    allowed_updates=["callback_query", "message"],
                )
                for update in result.get("result", []):
                    self._last_update_id = update["update_id"]
                    if "callback_query" in update:
                        self._handle_callback(update["callback_query"])
                    elif "message" in update:
                        self._handle_message(update["message"])
            except Exception as e:
                print(f"⚠️  Telegram poll error: {e}")
                time.sleep(5)


# ── Discord bot ────────────────────────────────────────────────────────────

class DiscordBot:
    """
    Posts hits to a Discord channel and polls for reply-based commands.

    User replies to a hit message with:
      send              — post the draft as-is
      skip              — discard this hit
      tweak: <instr>    — regenerate the draft with the given instruction
    """

    DISCORD_API = "https://discord.com/api/v10"

    def __init__(self, token: str, channel_id: str) -> None:
        self._token      = token
        self._channel_id = channel_id
        self._headers    = {
            "Authorization": f"Bot {token}",
            "Content-Type":  "application/json",
        }
        self._last_msg_id: str = "0"
        self._pending: dict    = {}  # parent_message_id → hit+draft session

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

    def _send(self, content: str, reply_to: str | None = None) -> str:
        """Post a message; returns the new message ID or empty string."""
        payload: dict = {"content": content}
        if reply_to:
            payload["message_reference"] = {"message_id": reply_to}
        result = self._api("POST", f"/channels/{self._channel_id}/messages",
                           json=payload)
        return result.get("id", "") if isinstance(result, dict) else ""

    # ── Send a new hit ────────────────────────────────────────────────────

    def send_hit(self, hit: dict, draft: str) -> None:
        source_icon  = {"hn": "🔶", "reddit": "🟠", "x": "🐦"}.get(hit["source"], "📡")
        source_label = {
            "hn":     "Hacker News",
            "reddit": f"r/{hit.get('subreddit', 'reddit')}",
            "x":      "Twitter/X",
        }.get(hit["source"], hit["source"])

        content = (
            f"{source_icon} **{source_label}**  ·  `{hit['keyword']}`\n\n"
            f"**{hit['title']}**\n"
            f"{hit['url']}\n\n"
            f"💬 **Suggested reply:**\n"
            f">>> {draft}\n\n"
            f"*Reply to this message: `send` · `skip` · `tweak: your instruction`*"
        )
        msg_id = self._send(content)
        if msg_id:
            self._pending[msg_id] = {**hit, "draft": draft}
            print(f"💬 Discord: sent [{hit['source']}] {hit['title'][:65]}")

    # ── Poll for replies ──────────────────────────────────────────────────

    def poll(self) -> None:
        """Long-poll the Discord channel for new messages. Runs in a daemon thread."""
        print("📡 Discord poll started")
        # Seed last_msg_id so we don't replay old messages on startup
        msgs = self._api("GET", f"/channels/{self._channel_id}/messages",
                         params={"limit": 1})
        if isinstance(msgs, list) and msgs:
            self._last_msg_id = msgs[0]["id"]

        while True:
            try:
                msgs = self._api("GET", f"/channels/{self._channel_id}/messages",
                                 params={"after": self._last_msg_id, "limit": 100})
                if isinstance(msgs, list):
                    for msg in reversed(msgs):   # oldest first
                        self._last_msg_id = msg["id"]
                        self._handle_message(msg)
            except Exception as e:
                print(f"⚠️  Discord poll error: {e}")
            time.sleep(3)

    def _handle_message(self, msg: dict) -> None:
        ref       = msg.get("message_reference", {})
        parent_id = ref.get("message_id")
        if not parent_id or parent_id not in self._pending:
            return

        text    = msg.get("content", "").strip()
        cmd     = text.lower().split(":")[0].strip()
        session = self._pending[parent_id]

        if cmd == "skip":
            self._pending.pop(parent_id, None)
            self._send("⏭️ Skipped.", reply_to=msg["id"])

        elif cmd == "send":
            self._do_post(parent_id, session, msg["id"])

        elif cmd == "tweak":
            instruction = text[text.index(":") + 1:].strip() if ":" in text else ""
            if not instruction:
                self._send("Usage: `tweak: your instruction here`", reply_to=msg["id"])
                return
            self._send("✍️ Rewriting…", reply_to=msg["id"])
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
                self._send("❌ Couldn't rewrite. Try again.", reply_to=msg["id"])
                return
            session["draft"] = new_draft
            source_icon = {"hn": "🔶", "reddit": "🟠", "x": "🐦"}.get(session["source"], "📡")
            self._send(
                f"{source_icon} **Revised reply:**\n>>> {new_draft}\n\n"
                f"*Reply with `send` or `skip`*",
                reply_to=msg["id"],
            )

    def _do_post(self, parent_id: str, session: dict, reply_to_id: str) -> None:
        source = session["source"]
        draft  = session["draft"]
        url    = session["url"]

        if source == "x":
            tweet_id = session.get("tweet_id", "")
            if all([X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET]):
                ok = _post_reply_x(tweet_id, draft)
                if ok:
                    self._send(f"✅ Reply posted to X!\n{url}", reply_to=reply_to_id)
                else:
                    self._send(
                        f"❌ X post failed — copy manually:\n```\n{draft}\n```\n{url}",
                        reply_to=reply_to_id,
                    )
            else:
                self._send(
                    f"📋 **Post on X:**\n```\n{draft}\n```\n{url}",
                    reply_to=reply_to_id,
                )
        elif source == "reddit":
            self._send(
                f"📋 **Post on Reddit:**\n```\n{draft}\n```\n{url}",
                reply_to=reply_to_id,
            )
        elif source == "hn":
            hn_comment_url = f"https://news.ycombinator.com/item?id={session.get('hn_id', '')}"
            self._send(
                f"📋 **Post on HN:**\n```\n{draft}\n```\n{hn_comment_url}",
                reply_to=reply_to_id,
            )

        self._pending.pop(parent_id, None)


# ── Monitor job ────────────────────────────────────────────────────────────

_bot: CommunityBot | None = None
_discord_bot: DiscordBot | None = None


def run_monitor() -> None:
    global _bot, _discord_bot
    now = datetime.now(CET).strftime("%Y-%m-%d %H:%M CET")
    print(f"\n🔍 Monitor run — {now}")

    seen     = _load_seen()
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

    _save_seen(seen)
    print(f"  {len(all_hits)} new hit(s) found")

    if not all_hits:
        return

    for hit in all_hits:
        draft = draft_reply(hit)
        if not draft:
            continue
        if _bot is not None:
            _bot.send_hit(hit, draft)
            time.sleep(1.2)  # avoid Telegram flood limits
        if _discord_bot is not None:
            _discord_bot.send_hit(hit, draft)
            time.sleep(0.5)


# ── Entry point ────────────────────────────────────────────────────────────

def main() -> None:
    global _bot, _discord_bot

    missing = [v for v in ("GROK_API_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID")
               if not os.getenv(v)]
    if missing:
        print(f"❌ Missing required env vars: {', '.join(missing)}")
        print("   Copy .env.example to .env and fill in the values.")
        sys.exit(1)

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    _bot = CommunityBot()
    poll_thread = threading.Thread(target=_bot.poll, daemon=True, name="tg-poll")
    poll_thread.start()

    if DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID:
        _discord_bot = DiscordBot(DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID)
        discord_thread = threading.Thread(target=_discord_bot.poll,
                                          daemon=True, name="discord-poll")
        discord_thread.start()
        print(f"💬 Discord routing enabled → channel {DISCORD_CHANNEL_ID}")
    else:
        print("ℹ️  Discord routing disabled (set DISCORD_BOT_TOKEN + DISCORD_CHANNEL_ID to enable)")

    # Run immediately on startup, then every 3 hours
    run_monitor()
    schedule.every(3).hours.do(run_monitor)

    print("\n⏰ Scheduler active — running every 3 hours. Ctrl+C to stop.\n")
    while True:
        schedule.run_pending()
        time.sleep(30)


if __name__ == "__main__":
    main()
