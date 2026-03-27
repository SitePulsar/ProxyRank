#!/bin/zsh
# start.sh — launch ProxyRank monitor + Claude Code (with Telegram channel)
# in persistent screen sessions that survive terminal closes.
#
# Usage:
#   ./start.sh          — start everything
#   ./start.sh monitor  — start only community_monitor.py
#   ./start.sh claude   — start only Claude Code
#
# Attach later:
#   screen -r proxyrank-monitor   — see monitor logs
#   screen -r proxyrank-claude    — interact with Claude Code
#
# Detach (leave running):
#   Ctrl+A  then  D

DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON="$DIR/.venv/bin/python"
MONITOR="$DIR/community_monitor.py"

start_monitor() {
    if screen -list | grep -q "proxyrank-monitor"; then
        echo "⚠️  Monitor already running. Attach with: screen -r proxyrank-monitor"
    else
        screen -dmS proxyrank-monitor "$PYTHON" "$MONITOR"
        echo "✅ Monitor started  →  screen -r proxyrank-monitor"
    fi
}

start_claude() {
    if screen -list | grep -q "proxyrank-claude"; then
        echo "⚠️  Claude already running. Attach with: screen -r proxyrank-claude"
    else
        screen -dmS proxyrank-claude claude --channels plugin:telegram@claude-plugins-official
        echo "✅ Claude started   →  screen -r proxyrank-claude"
        echo "   (attach once to complete any first-run prompts)"
    fi
}

case "${1:-all}" in
    monitor) start_monitor ;;
    claude)  start_claude  ;;
    all)
        start_monitor
        start_claude
        echo ""
        echo "─────────────────────────────────────"
        screen -list | grep proxyrank || true
        echo "─────────────────────────────────────"
        echo "Attach → screen -r <name>"
        echo "Detach → Ctrl+A then D"
        echo "Stop   → ./stop.sh"
        ;;
    *)
        echo "Usage: $0 [monitor|claude|all]"
        exit 1
        ;;
esac
