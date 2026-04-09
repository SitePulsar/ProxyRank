#!/usr/bin/env python3
"""
discord_watchdog.py — Always-running watchdog for the ProxyRank Claude Code session.

Polls the Discord DM channel for control commands:
  !restart   — kill + relaunch the proxyrank-claude screen session
  !stop      — kill the proxyrank-claude screen session
  !status    — report whether the claude session is running

Runs independently of Claude Code so it survives token-limit / compaction hangs.
Start via: ./start.sh watchdog  (or directly: python discord_watchdog.py)
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import requests as _requests
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN  = os.getenv("DISCORD_BOT_TOKEN", "")
CHANNEL_ID = os.getenv("DISCORD_NOTIFY_CHANNEL_ID", "") or os.getenv("DISCORD_CHANNEL_ID", "")
DISCORD_API = "https://discord.com/api/v10"

SCREEN_NAME   = "proxyrank-claude"
DIR           = Path(__file__).parent
CLAUDE_CMD    = f"claude --channels plugin:discord@claude-plugins-official,plugin:telegram@claude-plugins-official"

POLL_INTERVAL = 8  # seconds


def _auth() -> dict:
    return {"Authorization": f"Bot {BOT_TOKEN}"}


def send(msg: str) -> None:
    try:
        _requests.post(
            f"{DISCORD_API}/channels/{CHANNEL_ID}/messages",
            headers={**_auth(), "Content-Type": "application/json"},
            json={"content": msg},
            timeout=10,
        )
    except Exception:
        pass


def session_running() -> bool:
    # Check screen session
    result = subprocess.run(["screen", "-list"], capture_output=True, text=True)
    if SCREEN_NAME in result.stdout:
        return True
    # Also check for a live claude process (running directly, not in screen)
    ps = subprocess.run(["pgrep", "-f", "claude"], capture_output=True, text=True)
    return bool(ps.stdout.strip())


def restart_session() -> None:
    # Kill existing session
    subprocess.run(["screen", "-S", SCREEN_NAME, "-X", "quit"],
                   capture_output=True)
    time.sleep(2)
    # Launch new session
    subprocess.run(
        ["screen", "-dmS", SCREEN_NAME] + CLAUDE_CMD.split(),
        cwd=str(DIR),
    )
    time.sleep(2)


def stop_session() -> None:
    subprocess.run(["screen", "-S", SCREEN_NAME, "-X", "quit"],
                   capture_output=True)


def main():
    if not BOT_TOKEN or not CHANNEL_ID:
        print("❌ DISCORD_BOT_TOKEN or DISCORD_NOTIFY_CHANNEL_ID not set")
        sys.exit(1)

    print(f"👀 Watchdog running — polling #{CHANNEL_ID} every {POLL_INTERVAL}s")
    send("👀 Watchdog online. Commands: `!restart` · `!stop` · `!status`")

    last_id = ""

    while True:
        try:
            params = {"limit": 5}
            if last_id:
                params["after"] = last_id
            resp = _requests.get(
                f"{DISCORD_API}/channels/{CHANNEL_ID}/messages",
                headers=_auth(),
                params=params,
                timeout=10,
            )
            resp.raise_for_status()
            msgs = resp.json()

            for msg in reversed(msgs):
                mid     = msg.get("id", "")
                content = msg.get("content", "").strip().lower()
                # Skip own bot messages
                if msg.get("author", {}).get("bot"):
                    if not last_id or mid > last_id:
                        last_id = mid
                    continue
                if not last_id or mid > last_id:
                    last_id = mid

                if content == "!restart":
                    send("🔄 Restarting Claude Code session…")
                    restart_session()
                    if session_running():
                        send("✅ Session restarted. Give it ~10 seconds to connect.")
                    else:
                        send("⚠️ Restart attempted but session not detected — check terminal.")

                elif content == "!stop":
                    send("🛑 Stopping Claude Code session…")
                    stop_session()
                    send("✅ Session stopped.")

                elif content == "!status":
                    if session_running():
                        send(f"✅ `{SCREEN_NAME}` is running.")
                    else:
                        send(f"❌ `{SCREEN_NAME}` is NOT running. Type `!restart` to start it.")

        except Exception as e:
            print(f"⚠️  Poll error: {e}")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
