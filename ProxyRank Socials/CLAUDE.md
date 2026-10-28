# ProxyRank Socials — Local Context

---

## ⚠️ Subscription-first, API second (cost rule — read first)

**Default: Claude Code subscription. Fallback: metered Anthropic API.** Before adding any new `anthropic` SDK / `@anthropic-ai/sdk` call to this workspace, ask: *"could this be a Claude Code routine (`schedule` skill, `RemoteTrigger`, `/loop`, or a `claude-prs` session) instead?"* Subscription is flat-rate (zero marginal cost); API is metered.

Today this repo uses Grok (xAI, not Anthropic) for reply drafting — Grok spend is unaffected — but the rule applies if any Anthropic-backed feature lands here. Full rule: `~/.claude/CLAUDE.md` (top of file).

---

## Workspace Identity
- Directory: `ProxyRank/ProxyRank Socials/`
- Claude alias: `claude-prs` | Tab: PRS | Discord: ProxyRank Socials bot

## What this repo is

A community signal monitor for **ProxyRank.ai** — an MCP server and CLI tool audit platform. The monitor polls Hacker News, Reddit, and X/Twitter for relevant keywords, drafts developer-friendly replies using Grok, and routes them to Discord for human review before posting.

## Running the monitor

```zsh
# Start everything (monitor + Claude Code channel) in persistent screen sessions
./start.sh

# Start only the monitor
./start.sh monitor

# Run once in test mode (bypasses dedup, exits after sending)
.venv/bin/python community_monitor.py --test

# Stop all sessions
./stop.sh

# Attach to see live logs
screen -r proxyrank-monitor

# Detach without stopping
Ctrl+A then D
```

The monitor runs immediately on start, then every 3 hours via `schedule`.

## Architecture

Everything lives in a single file: `community_monitor.py`.

**Data flow:**
1. `run_monitor()` fetches hits from HN (`_fetch_hn`), Reddit (`_fetch_reddit`), X (`_fetch_x`)
2. Hits are filtered (keyword must appear in title, EXCLUDE_KEYWORDS checked), deduped, capped at `MAX_HITS_PER_RUN = 5`
3. Each hit gets a Grok-drafted reply via `draft_reply()`
4. Hits are sent to `DiscordBot` for human review (Telegram `CommunityBot` removed 2026-10-28)

**Approval flow — Discord (`DiscordBot`):**
- Posts a card message + draft as a reply
- Polls channels every 3 seconds for reply commands: `send`, `skip`, `tweak: instruction`
- `_do_post()` auto-posts to X or sends copy-paste text for Reddit/HN

**X posting:** Uses custom OAuth 1.0a signing (`_x_oauth1_header`) — no third-party OAuth library. Requires all four `X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET` vars; falls back to copy-paste if any are missing.

**State persistence:**
- `community_state.json` — seen post UIDs (dedup across runs)
- `discord_sessions_state.json` — pending Discord sessions
- `community_sessions_state.json` — legacy Telegram sessions; no longer read. Pending Telegram approvals are dropped (not migrated): the file is left in place as an archive and can be deleted once reviewed. Hits that were only pending on Telegram will not re-surface (their UIDs are in `community_state.json`).

All writes are atomic (write to `.tmp` then `os.rename`).

## Environment variables

Copy `.env.example` to `.env`. Required:
- `GROK_API_KEY` — reply drafting (grok-3)
- `DISCORD_BOT_TOKEN` + `DISCORD_CHANNEL_ID` (or `DISCORD_CHANNEL_ID_HN` / `_REDDIT` / `_X`)

Optional:
- `X_BEARER_TOKEN` — enables X search (read-only)
- `X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET` — enables auto-posting X replies (OAuth 1.0a, Access Token must have Read+Write permission)
- `DISCORD_BOT_TOKEN` + `DISCORD_CHANNEL_ID` — enables Discord routing
- `DATA_DIR` — overrides state file location (defaults to script directory)

## Brand context

`BUSINESS_CONTEXT.md` defines the product, tone, and per-platform reply guidance. It is injected into Grok prompts. Keep it updated — especially the `⚠️ FILL THIS IN` section (product status, pricing, one-liner).

Key tone rules: developer-to-developer, no emojis in replies, no forced ProxyRank mentions, 2-3 sentences for unsolicited replies.


---

## Feature Learnings
_Compiled after each feature build. Follow the 4-step workflow defined in ~/.claude/CLAUDE.md._

<!-- [YYYY-MM-DD] Feature name — what worked / what failed -->
