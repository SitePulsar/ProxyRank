#!/usr/bin/env python3
"""
mcp_review_monitor.py — ProxyRank MCP launch scanner

Scans Reddit for posts where developers announce new MCP servers,
audits them with ProxyRank, drafts a reply, and posts to Discord
for one-tap approve/reject.

Schedule : every 6 hours
Channel  : #mcp-review-reply (DISCORD_CHANNEL_ID_MCP_REVIEW)

Required .env (shared with community_monitor.py):
    GROK_API_KEY
    DISCORD_BOT_TOKEN
    DISCORD_CHANNEL_ID_MCP_REVIEW

State file:
    mcp_review_state.json  — seen post IDs (dedup)
"""

from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
import urllib.parse
from datetime import datetime
from pathlib import Path

import pytz
import requests
import schedule
import websocket
from dotenv import load_dotenv

# ── Config ──────────────────────────────────────────────────────────────────

load_dotenv()

GROK_API_KEY          = os.getenv("GROK_API_KEY", "")
DISCORD_BOT_TOKEN     = os.getenv("DISCORD_BOT_TOKEN", "")
DISCORD_REVIEW_CH     = os.getenv("DISCORD_CHANNEL_ID_MCP_REVIEW", "")
PROXYRANK_API         = "https://proxyrank.ai/api/audit"
GROK_URL              = "https://api.x.ai/v1/chat/completions"
GROK_MODEL            = "grok-3"
DISCORD_API           = "https://discord.com/api/v10"

_data_env = os.getenv("DATA_DIR", "")
DATA_DIR  = Path(_data_env) if _data_env else Path(__file__).parent
CET       = pytz.timezone("Europe/Amsterdam")

STATE_PATH = DATA_DIR / "mcp_review_state.json"

LAUNCH_KEYWORDS = ["i built", "i created", "show mcp", "new mcp", "released", "launching",
                   "announcing", "just published", "just released", "open source mcp"]

SUBREDDITS = ["mcp", "ModelContextProtocol", "AIagents", "artificial", "LocalLLaMA"]

HN_SEARCH_URL = "https://hn.algolia.com/api/v1/search_by_date"
HN_KEYWORDS   = ["mcp server", "model context protocol", "show hn: mcp", "mcp tool"]

MAX_PER_RUN = 3  # total across HN + Reddit combined

# ── State ───────────────────────────────────────────────────────────────────

def _load_state() -> dict:
    if STATE_PATH.exists():
        try:
            return json.loads(STATE_PATH.read_text())
        except Exception:
            pass
    return {"seen": [], "responded": []}

def _load_seen() -> set:
    return set(_load_state().get("seen", []))

def _save_seen(seen: set) -> None:
    state = _load_state()
    state["seen"] = sorted(seen)
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2))
    tmp.replace(STATE_PATH)

def _mark_responded(hit: dict, reply: str, score: str) -> None:
    """Record that a reply was sent for this post."""
    state = _load_state()
    responded = state.get("responded", [])
    responded.append({
        "reddit_url": hit["url"],
        "title": hit["title"],
        "subreddit": hit["subreddit"],
        "author": hit["author"],
        "score": score,
        "reply_preview": reply[:120],
        "sent_at": datetime.now(CET).strftime("%Y-%m-%d %H:%M CET"),
    })
    state["responded"] = responded
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2))
    tmp.replace(STATE_PATH)

# ── Grok ────────────────────────────────────────────────────────────────────

def _grok(system: str, user: str, max_tokens: int = 500) -> str:
    if not GROK_API_KEY:
        return ""
    try:
        resp = requests.post(
            GROK_URL,
            headers={"Authorization": f"Bearer {GROK_API_KEY}", "Content-Type": "application/json"},
            json={"model": GROK_MODEL, "temperature": 0.7, "max_tokens": max_tokens,
                  "messages": [{"role": "system", "content": system},
                                {"role": "user",   "content": user}]},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        print(f"⚠️  Grok error: {e}")
        return ""

# ── Reddit scan ─────────────────────────────────────────────────────────────

def _find_github_in_comments(subreddit: str, post_id: str, headers: dict) -> str:
    """Fetch top comments for a post and return first GitHub URL found."""
    try:
        resp = requests.get(
            f"https://www.reddit.com/r/{subreddit}/comments/{post_id}.json",
            params={"limit": 10, "depth": 1},
            headers=headers,
            timeout=10,
        )
        if resp.status_code != 200:
            return ""
        data = resp.json()
        if len(data) < 2:
            return ""
        for child in data[1].get("data", {}).get("children", []):
            body = child.get("data", {}).get("body", "")
            urls = re.findall(r'https?://github\.com/[\w.-]+/[\w.-]+', body)
            if urls:
                return urls[0]
    except Exception:
        pass
    return ""

def _follow_reddit_crosspost(post_url: str, headers: dict) -> str:
    """If post_url is a Reddit crosspost, fetch the target post and extract GitHub URL."""
    if not post_url or "reddit.com" not in post_url and not post_url.startswith("/r/"):
        return ""
    try:
        full_url = ("https://www.reddit.com" + post_url) if post_url.startswith("/r/") else post_url
        if not full_url.endswith(".json"):
            full_url = full_url.rstrip("/") + ".json"
        resp = requests.get(full_url, params={"limit": 5, "depth": 1}, headers=headers, timeout=10)
        if resp.status_code != 200:
            return ""
        data = resp.json()
        if not isinstance(data, list) or not data:
            return ""
        # data[0] is the post listing
        post_data = data[0].get("data", {}).get("children", [{}])[0].get("data", {})
        all_text = post_data.get("selftext", "") + " " + post_data.get("url", "")
        urls = re.findall(r'https?://github\.com/[\w.-]+/[\w.-]+', all_text)
        if urls:
            return urls[0]
        # Also check comments (data[1])
        if len(data) > 1:
            for child in data[1].get("data", {}).get("children", []):
                body = child.get("data", {}).get("body", "")
                urls = re.findall(r'https?://github\.com/[\w.-]+/[\w.-]+', body)
                if urls:
                    return urls[0]
    except Exception:
        pass
    return ""

def _search_github_for_repo(title: str) -> str:
    """Search GitHub for a repo matching the post title. Returns URL or empty string."""
    # Strip common filler words
    query = re.sub(r'\b(i built|i created|new|mcp server|mcp|for|the|a|an)\b', ' ', title, flags=re.IGNORECASE)
    query = re.sub(r'\s+', ' ', query).strip()[:60]
    if len(query) < 5:
        return ""
    try:
        resp = requests.get(
            "https://api.github.com/search/repositories",
            params={"q": query + " mcp", "sort": "updated", "per_page": 3},
            timeout=10,
        )
        if resp.status_code == 200:
            items = resp.json().get("items", [])
            if items:
                return items[0]["html_url"]
    except Exception:
        pass
    return ""

def _fetch_mcp_launches(seen: set) -> list[dict]:
    """Search Reddit for posts announcing new MCP servers."""
    hits = []
    headers = {"User-Agent": "ProxyRankReviewMonitor/1.0"}
    for sub in SUBREDDITS:
        try:
            resp = requests.get(
                f"https://www.reddit.com/r/{sub}/new.json",
                params={"limit": 25},
                headers=headers,
                timeout=15,
            )
            if resp.status_code in (429, 403):
                time.sleep(2)
                continue
            resp.raise_for_status()
            for child in resp.json().get("data", {}).get("children", []):
                post = child["data"]
                uid  = f"review:reddit:{post['id']}"
                if uid in seen:
                    continue
                title   = post.get("title", "").lower()
                selftext = post.get("selftext", "").lower()
                combined = title + " " + selftext

                # Must mention MCP and sound like a launch
                has_mcp    = "mcp" in combined or "model context protocol" in combined
                has_launch = any(kw in combined for kw in LAUNCH_KEYWORDS)
                if not (has_mcp and has_launch):
                    continue

                # Extract GitHub URL — check post body first
                all_text = post.get("title", "") + " " + post.get("selftext", "") + " " + post.get("url", "")
                github_urls = re.findall(r'https?://github\.com/[\w.-]+/[\w.-]+', all_text)
                github_url  = github_urls[0] if github_urls else ""

                # If not found, follow crosspost URL (e.g. /r/Python/comments/...)
                if not github_url:
                    post_url = post.get("url", "")
                    if "/r/" in post_url and "/comments/" in post_url:
                        github_url = _follow_reddit_crosspost(post_url, headers)

                # If still not found, check top comments
                if not github_url:
                    github_url = _find_github_in_comments(sub, post["id"], headers)

                # Last resort: GitHub search by title
                if not github_url:
                    github_url = _search_github_for_repo(post.get("title", ""))

                seen.add(uid)
                hits.append({
                    "uid":        uid,
                    "reddit_id":  post["id"],
                    "subreddit":  sub,
                    "title":      post.get("title", "(no title)"),
                    "url":        f"https://reddit.com{post.get('permalink', '')}",
                    "selftext":   post.get("selftext", "")[:800],
                    "author":     post.get("author", ""),
                    "score":      post.get("score", 0),
                    "github_url": github_url,
                })
        except Exception as e:
            print(f"⚠️  Reddit scan error (r/{sub}): {e}")
        time.sleep(0.8)
    return hits

# ── HN scan ─────────────────────────────────────────────────────────────────

def _fetch_hn_launches(seen: set) -> list[dict]:
    """Search HN for Show HN / Ask HN posts about new MCP servers."""
    hits = []
    for kw in HN_KEYWORDS:
        try:
            resp = requests.get(
                HN_SEARCH_URL,
                params={"query": kw, "tags": "story", "hitsPerPage": 10},
                timeout=15,
            )
            resp.raise_for_status()
            for item in resp.json().get("hits", []):
                uid = f"review:hn:{item.get('objectID', '')}"
                if uid in seen:
                    continue
                title    = item.get("title", "")
                story_text = item.get("story_text") or ""
                combined = (title + " " + story_text).lower()

                has_mcp    = "mcp" in combined or "model context protocol" in combined
                has_launch = any(kw2 in combined for kw2 in ["show hn", "i built", "i made",
                                 "released", "new mcp", "introducing", "announcing"])
                if not (has_mcp and has_launch):
                    continue

                url_field = item.get("url", "")
                all_text  = title + " " + story_text + " " + url_field
                github_urls = re.findall(r'https?://github\.com/[\w.-]+/[\w.-]+', all_text)
                github_url  = github_urls[0] if github_urls else ""

                hn_url = f"https://news.ycombinator.com/item?id={item.get('objectID','')}"
                seen.add(uid)
                hits.append({
                    "uid":        uid,
                    "subreddit":  "HackerNews",
                    "title":      title,
                    "url":        hn_url,
                    "selftext":   story_text[:800],
                    "author":     item.get("author", ""),
                    "score":      item.get("points", 0),
                    "github_url": github_url,
                    "source":     "hn",
                })
        except Exception as e:
            print(f"⚠️  HN scan error ({kw}): {e}")
        time.sleep(0.3)

    # Deduplicate by title within this batch
    seen_titles: set = set()
    unique = []
    for h in hits:
        t = h["title"].lower()[:60]
        if t not in seen_titles:
            seen_titles.add(t)
            unique.append(h)
    return unique

# ── Manifest extraction ──────────────────────────────────────────────────────

def _get_raw_github(github_url: str, path: str) -> str | None:
    """Try to fetch a file from a GitHub repo via raw.githubusercontent.com."""
    match = re.match(r'https?://github\.com/([\w.-]+)/([\w.-]+)', github_url)
    if not match:
        return None
    user, repo = match.group(1), match.group(2)
    for branch in ["main", "master"]:
        url = f"https://raw.githubusercontent.com/{user}/{repo}/{branch}/{path}"
        try:
            resp = requests.get(url, timeout=10)
            if resp.status_code == 200:
                return resp.text
        except Exception:
            pass
    return None

def _list_github_dir(github_url: str, path: str = "") -> list[dict]:
    """Return GitHub API contents listing for a repo directory."""
    match = re.match(r'https?://github\.com/([\w.-]+)/([\w.-]+)', github_url)
    if not match:
        return []
    user, repo = match.group(1), match.group(2)
    api_url = f"https://api.github.com/repos/{user}/{repo}/contents/{path}"
    try:
        resp = requests.get(api_url, timeout=10)
        if resp.status_code == 200:
            return resp.json() if isinstance(resp.json(), list) else []
    except Exception:
        pass
    return []

def _extract_tools_from_python(src: str) -> list[dict]:
    """Parse a FastMCP Python file and extract @mcp.tool() definitions."""
    tools = []
    fn_matches = list(re.finditer(
        r'@(?:mcp|server)\.tool\(\)\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)',
        src, re.DOTALL
    ))
    for fm in fn_matches:
        fn_name = fm.group(1)
        params_str = fm.group(2)

        # Docstring
        after_def = src[fm.end():]
        doc_match = re.search(r'^\s*:?\s*"""(.*?)"""', after_def, re.DOTALL)
        description = ""
        if doc_match:
            raw_doc = doc_match.group(1).strip()
            lines = [l.strip() for l in raw_doc.split('\n') if l.strip()]
            description = lines[0] if lines else ""

        # Parameters
        properties: dict = {}
        required: list = []
        type_map = {'str': 'string', 'int': 'integer', 'float': 'number', 'bool': 'boolean',
                    'list': 'array', 'dict': 'object', 'Optional[str]': 'string',
                    'Optional[int]': 'integer', 'Optional[bool]': 'boolean'}
        for pm in re.finditer(r'(\w+)\s*:\s*([\w\[\]]+)(?:\s*=\s*([^,\n]+))?', params_str):
            pname, ptype, default = pm.group(1), pm.group(2).strip(), pm.group(3)
            if pname in ('self', 'cls', 'ctx'):
                continue
            json_type = type_map.get(ptype, 'string')
            properties[pname] = {"type": json_type}
            if default is None:
                required.append(pname)

        tool: dict = {
            "name": fn_name,
            "description": description[:250],
            "inputSchema": {"type": "object", "properties": properties},
        }
        if required:
            tool["inputSchema"]["required"] = required
        tools.append(tool)
    return tools

def _extract_from_python_sources(github_url: str) -> tuple[str | None, str]:
    """
    Scan the repo for Python source files using @mcp.tool() and build manifest.
    Tries: root, src/, server.py, tools/ dir.
    """
    # Candidate single-file paths
    single_paths = ["server.py", "src/server.py", "main.py", "src/main.py",
                    "app.py", "src/app.py", "mcp_server.py", "src/mcp_server.py"]
    all_tools: list[dict] = []

    # Try single-file paths first
    for path in single_paths:
        src = _get_raw_github(github_url, path)
        if src and "@mcp.tool" in src:
            tools = _extract_tools_from_python(src)
            if tools:
                all_tools.extend(tools)
                print(f"    🐍 Extracted {len(tools)} tools from {path}")
                break  # one main file is enough

    # If nothing yet, look for a tools/ directory
    if not all_tools:
        entries = _list_github_dir(github_url, "tools")
        py_files = [e for e in entries if e.get("type") == "file" and e["name"].endswith(".py")]
        for entry in py_files[:50]:  # cap at 50 to avoid rate limits
            try:
                resp = requests.get(entry["download_url"], timeout=8)
                if resp.status_code == 200 and "@mcp.tool" in resp.text:
                    tools = _extract_tools_from_python(resp.text)
                    all_tools.extend(tools)
            except Exception:
                pass
            time.sleep(0.05)
        if all_tools:
            print(f"    🐍 Extracted {len(all_tools)} tools from tools/ dir")

    # Also check root for any .py files with @mcp.tool
    if not all_tools:
        entries = _list_github_dir(github_url, "")
        py_files = [e for e in entries if e.get("type") == "file" and e["name"].endswith(".py")]
        for entry in py_files[:10]:
            try:
                resp = requests.get(entry["download_url"], timeout=8)
                if resp.status_code == 200 and "@mcp.tool" in resp.text:
                    tools = _extract_tools_from_python(resp.text)
                    all_tools.extend(tools)
            except Exception:
                pass

    if not all_tools:
        return None, "no @mcp.tool() functions found in source"

    manifest = json.dumps({"tools": all_tools}, indent=2)
    return manifest, f"Python source extraction ({len(all_tools)} tools)"

def _build_manifest_from_readme(hit: dict) -> tuple[str | None, str]:
    """
    Try to build an mcp.json from the README using Grok.
    Returns (manifest_json_str, source_description).
    """
    readme = _get_raw_github(hit["github_url"], "README.md")
    if not readme:
        readme = hit["selftext"]

    if not readme or len(readme) < 50:
        return None, "no README"

    system = (
        "You are a technical parser. Given a README or description of an MCP server, "
        "extract the tool definitions and output a valid JSON manifest. "
        "Output a JSON object with a 'tools' array. Each tool has: "
        "name (string), description (string, max 250 chars), inputSchema (object with type='object', properties={}, optional required=[]). "
        "Output ONLY valid JSON, no explanation, no markdown fences."
    )
    user = (
        f"Project: {hit['title']}\n"
        f"GitHub: {hit.get('github_url', 'unknown')}\n\n"
        f"README/description:\n{readme[:3000]}\n\n"
        "Output the manifest JSON:"
    )
    manifest_str = _grok(system, user, max_tokens=2000)
    manifest_str = re.sub(r'^```(?:json)?\s*', '', manifest_str, flags=re.MULTILINE)
    manifest_str = re.sub(r'\s*```$', '', manifest_str, flags=re.MULTILINE)
    manifest_str = manifest_str.strip()
    try:
        parsed = json.loads(manifest_str)
        # Ensure it has a tools array
        if "tools" not in parsed:
            return None, "Grok extraction: no tools array"
        return manifest_str, "README → Grok extraction"
    except Exception:
        return None, "Grok extraction failed (invalid JSON)"

def _get_audit_url(manifest_str: str) -> str | None:
    """Upload manifest to paste.rs and return the URL."""
    try:
        resp = requests.post("https://paste.rs", data=manifest_str.encode(), timeout=10)
        if resp.status_code == 201:
            return resp.text.strip()
        return None
    except Exception:
        return None

def _run_proxyrank_audit(paste_url: str) -> dict | None:
    """Submit manifest URL to ProxyRank and return the result."""
    try:
        resp = requests.post(
            PROXYRANK_API,
            json={"url": paste_url},
            timeout=60,
        )
        if resp.status_code == 200:
            return resp.json()
        print(f"⚠️  ProxyRank error: {resp.status_code} {resp.text[:200]}")
        return None
    except Exception as e:
        print(f"⚠️  ProxyRank request failed: {e}")
        return None

# ── Reply draft ──────────────────────────────────────────────────────────────

def _draft_reply(hit: dict, audit: dict | None) -> str:
    score_line = ""
    if audit:
        score      = audit.get("score", "?")
        avail      = audit.get("availablePoints", 75)
        score_line = f"ProxyScore {score}/{avail}"

    system = (
        "You are a developer who builds and reviews MCP servers. "
        "Reply to posts where devs share new MCP servers. "
        "Be constructive: lead with a genuine technical observation about their design, "
        "tool naming, schema quality, or use case — something actionable they could improve or that stands out. "
        "If the ProxyScore is available, mention it briefly at the end with one specific, constructive finding "
        "(e.g. 'scored 34/75 — main drag was generic verb prefixes on tool names'). "
        "Do NOT mention proxyrank.ai, do NOT say 'free audit', do NOT pitch anything. "
        "The account is already called ProxyRank — no intro needed. "
        "End with a natural question or invitation for their thoughts. "
        "Rules: 2–3 sentences max. No emojis. No bullet points. Developer tone. "
        "Do NOT start with 'Hey', 'Great', 'I', or a compliment."
    )
    user = (
        f"Post title: {hit['title']}\n"
        f"Subreddit: r/{hit['subreddit']}\n"
        f"Post snippet: {hit['selftext'][:400]}\n"
        f"ProxyRank result: {score_line or 'audit not available'}\n\n"
        "Write a reply:"
    )
    return _grok(system, user, max_tokens=200)

# ── Discord ──────────────────────────────────────────────────────────────────

_discord_headers = {
    "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
    "Content-Type": "application/json",
}
_pending: dict = {}  # msg_id → {hit, audit, reply, paste_url}

def _discord_send(content: str, channel: str = DISCORD_REVIEW_CH,
                  reply_to: str | None = None, components: list | None = None) -> str:
    payload: dict = {"content": content}
    if reply_to:
        payload["message_reference"] = {"message_id": reply_to}
    if components:
        payload["components"] = components
    try:
        resp = requests.post(
            f"{DISCORD_API}/channels/{channel}/messages",
            headers=_discord_headers, json=payload, timeout=10,
        )
        resp.raise_for_status()
        return resp.json().get("id", "")
    except Exception as e:
        print(f"⚠️  Discord send error: {e}")
        return ""

def _discord_edit(msg_id: str, content: str, channel: str = DISCORD_REVIEW_CH,
                  components: list | None = None) -> None:
    payload: dict = {"content": content}
    if components is not None:
        payload["components"] = components
    try:
        requests.patch(
            f"{DISCORD_API}/channels/{channel}/messages/{msg_id}",
            headers=_discord_headers, json=payload, timeout=10,
        )
    except Exception as e:
        print(f"⚠️  Discord edit error: {e}")

def _post_review(hit: dict, audit: dict | None, reply_text: str, paste_url: str | None) -> None:
    """Post the full review card to the Discord review channel."""
    score = audit.get("score", "?") if audit else "N/A"
    avail = audit.get("availablePoints", 75) if audit else 75
    label = _score_label(score if isinstance(score, int) else 0)

    # Card header
    source_label = "HN" if hit.get("source") == "hn" else f"r/{hit['subreddit']}"
    header = (
        f"🔍 **New MCP — {source_label}**\n"
        f"**{hit['title']}**\n"
        f"by u/{hit['author']}  ·  {hit['score']} upvotes\n"
        f"{hit['url']}\n\n"
        f"📊 **ProxyScore: {score}/{avail}** — {label}"
    )
    _discord_send(header)

    # Reply text — plain block for easy copy on mobile
    reply_block = f"**Reply text — long-press to copy:**\n```\n{reply_text}\n```"
    reply_msg_id = _discord_send(reply_block)
    if not reply_msg_id:
        return

    # Audit URL
    audit_line = f"🔗 **Audit URL:** {paste_url}" if paste_url else "⚠️ Audit URL unavailable"
    _discord_send(audit_line)

    # Buttons on the reply block message
    buttons = [
        {"type": 2, "style": 3, "label": "✅ Send Reply", "custom_id": f"review_send:{reply_msg_id}"},
        {"type": 2, "style": 4, "label": "❌ Reject",     "custom_id": f"review_reject:{reply_msg_id}"},
    ]
    _discord_edit(reply_msg_id, reply_block, components=[{"type": 1, "components": buttons}])

    _pending[reply_msg_id] = {
        "hit":       hit,
        "audit":     audit,
        "reply":     reply_text,
        "paste_url": paste_url,
    }
    print(f"📬 Review posted: {hit['title'][:60]}")

def _score_label(score: int) -> str:
    if score >= 60: return "Visible"
    if score >= 40: return "Borderline"
    return "Likely Invisible"

# ── Interaction handler ──────────────────────────────────────────────────────

def _ack(iid: str, token: str, content: str | None = None) -> None:
    body = {"type": 4, "data": {"content": content, "flags": 64}} if content else {"type": 6}
    try:
        requests.post(f"{DISCORD_API}/interactions/{iid}/{token}/callback",
                      json=body, timeout=3)
    except Exception:
        pass

def handle_interaction(data: dict) -> None:
    itype     = data.get("type")
    iid       = data.get("id", "")
    token     = data.get("token", "")
    custom_id = data.get("data", {}).get("custom_id", "")

    if itype != 3:
        return

    action, _, key = custom_id.partition(":")
    session = _pending.get(key)
    if not session:
        _ack(iid, token, "⏱ Session expired.")
        return

    if action == "review_reject":
        _ack(iid, token, "❌ Rejected.")
        _pending.pop(key, None)

    elif action == "review_send":
        hit   = session["hit"]
        reply = session["reply"]
        audit = session.get("audit") or {}
        score = f"{audit.get('score','?')}/{audit.get('availablePoints',75)}" if audit else "N/A"

        # Mark as responded in state
        _mark_responded(hit, reply, score)

        _ack(iid, token, "📋 Copy the text above and paste it on Reddit.")
        # Post a clean copy-paste confirmation + log line
        _discord_send(
            f"✅ **Sent** · r/{hit['subreddit']} · ProxyScore {score}\n"
            f"{hit['url']}\n\n"
            f"```\n{reply}\n```"
        )
        _pending.pop(key, None)

# ── Gateway ──────────────────────────────────────────────────────────────────

class Gateway:
    URL = "wss://gateway.discord.gg/?v=10&encoding=json"

    def __init__(self, token: str, on_interaction) -> None:
        self._token = token
        self._on_interaction = on_interaction
        self._seq: int | None = None
        self._hb: float = 41.25

    def start(self) -> None:
        while True:
            try:
                ws = websocket.WebSocketApp(
                    self.URL,
                    on_open    = lambda ws: None,
                    on_message = self._on_msg,
                    on_error   = lambda ws, e: print(f"⚠️  GW error: {e}"),
                    on_close   = lambda ws, c, m: print("🔌 GW closed — reconnecting…"),
                )
                ws.run_forever(ping_interval=0)
            except Exception as e:
                print(f"⚠️  GW exception: {e}")
            time.sleep(5)

    def _on_msg(self, ws, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except Exception:
            return
        op, t, d, s = msg.get("op"), msg.get("t"), msg.get("d") or {}, msg.get("s")
        if s: self._seq = s
        if op == 10:
            self._hb = d.get("heartbeat_interval", 41250) / 1000
            threading.Thread(target=self._heartbeat, args=(ws,), daemon=True).start()
            ws.send(json.dumps({"op": 2, "d": {
                "token": self._token, "intents": 0,
                "properties": {"os": "linux", "browser": "mcp-review", "device": "mcp-review"},
            }}))
        elif op == 1:
            ws.send(json.dumps({"op": 1, "d": self._seq}))
        elif op == 0 and t == "READY":
            print("✅ Review gateway ready")
        elif op == 0 and t == "INTERACTION_CREATE":
            try:
                self._on_interaction(d)
            except Exception as e:
                print(f"⚠️  Interaction error: {e}")

    def _heartbeat(self, ws) -> None:
        while True:
            time.sleep(self._hb)
            try:
                ws.send(json.dumps({"op": 1, "d": self._seq}))
            except Exception:
                break

# ── Command poller ───────────────────────────────────────────────────────────

def _poll_commands() -> None:
    """Poll the review channel for !log / !status commands."""
    last_id: str = ""
    while True:
        try:
            params: dict = {"limit": 5}
            if last_id:
                params["after"] = last_id
            resp = requests.get(
                f"{DISCORD_API}/channels/{DISCORD_REVIEW_CH}/messages",
                headers=_discord_headers, params=params, timeout=10,
            )
            if resp.status_code == 200:
                msgs = resp.json()
                for msg in reversed(msgs):
                    mid     = msg.get("id", "")
                    content = msg.get("content", "").strip().lower()
                    if not last_id or mid > last_id:
                        last_id = mid
                    if content in ("!log", "!status", "!responded"):
                        _send_log()
        except Exception as e:
            print(f"⚠️  Command poll error: {e}")
        time.sleep(10)

def _send_log() -> None:
    """Post a summary of all responded posts to the review channel."""
    state = _load_state()
    responded = state.get("responded", [])
    if not responded:
        _discord_send("📋 No replies sent yet.")
        return
    lines = ["📋 **Replied posts log:**\n"]
    for r in responded[-20:]:  # last 20
        lines.append(
            f"• **r/{r['subreddit']}** · {r['sent_at']} · ProxyScore {r['score']}\n"
            f"  [{r['title'][:60]}]({r['reddit_url']})"
        )
    _discord_send("\n".join(lines))

# ── Main job ─────────────────────────────────────────────────────────────────

def run_review(test: bool = False) -> None:
    now = datetime.now(CET).strftime("%Y-%m-%d %H:%M CET")
    print(f"\n🔍 MCP Review run — {now}")

    seen        = set() if test else _load_seen()
    reddit_hits = _fetch_mcp_launches(seen)
    hn_hits     = _fetch_hn_launches(seen)
    hits        = reddit_hits + hn_hits
    if not test:
        _save_seen(seen)

    print(f"  {len(hits)} new MCP launch(es) found (Reddit: {len(reddit_hits)}, HN: {len(hn_hits)})")
    hits = hits[:MAX_PER_RUN]

    for hit in hits:
        print(f"  → {hit['title'][:65]}")

        # 1. Try static manifest first
        paste_url = None
        audit     = None
        manifest_str = None

        if hit["github_url"]:
            # Try static manifest files first
            for path in [".well-known/mcp.json", "mcp.json", "manifest.json", "src/mcp.json"]:
                raw = _get_raw_github(hit["github_url"], path)
                if raw:
                    try:
                        parsed = json.loads(raw)
                        if "tools" in parsed:
                            manifest_str = raw
                            print(f"    ✅ Found static manifest at {path}")
                            break
                    except Exception:
                        pass

        # 2. Try Python source extraction (@mcp.tool() pattern)
        if not manifest_str and hit["github_url"]:
            print("    🐍 No static manifest — scanning Python sources…")
            manifest_str, source = _extract_from_python_sources(hit["github_url"])
            if manifest_str:
                print(f"    ✅ {source}")
            else:
                print(f"    ⚠️  {source}")

        # 3. Fall back to Grok extraction from README
        if not manifest_str:
            print("    📝 Falling back to README → Grok extraction…")
            manifest_str, source = _build_manifest_from_readme(hit)
            print(f"    {source}")

        # 3. Upload and audit
        if manifest_str:
            paste_url = _get_audit_url(manifest_str)
            if paste_url:
                print(f"    📎 Manifest at {paste_url}")
                audit = _run_proxyrank_audit(paste_url)
                if audit:
                    print(f"    📊 ProxyScore: {audit.get('score')}/{audit.get('availablePoints')}")

        # 4. Draft reply
        reply = _draft_reply(hit, audit)
        if not reply:
            print("    ⚠️  Reply draft failed — skipping")
            continue

        # 5. Post to Discord
        _post_review(hit, audit, reply, paste_url)
        time.sleep(1)


def main() -> None:
    if not GROK_API_KEY:
        print("❌ GROK_API_KEY not set")
        sys.exit(1)
    if not DISCORD_BOT_TOKEN or not DISCORD_REVIEW_CH:
        print("❌ DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID_MCP_REVIEW not set")
        sys.exit(1)

    test = "--test" in sys.argv
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # Start gateway for button interactions
    gw = Gateway(DISCORD_BOT_TOKEN, handle_interaction)
    threading.Thread(target=gw.start, daemon=True, name="review-gw").start()
    # Start command poller (!log, !status)
    threading.Thread(target=_poll_commands, daemon=True, name="review-cmd").start()
    print(f"💬 MCP Review monitor → #{DISCORD_REVIEW_CH}")

    if test:
        print("🧪 Test run")
        run_review(test=True)
        time.sleep(5)
        return

    run_review()
    schedule.every(6).hours.do(run_review)
    print("⏰ Scheduler active — every 6 hours.\n")
    while True:
        schedule.run_pending()
        time.sleep(30)


if __name__ == "__main__":
    main()
