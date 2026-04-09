#!/bin/zsh
# stop.sh — stop ProxyRank screen sessions

for session in proxyrank-monitor proxyrank-claude proxyrank-watchdog; do
    if screen -list | grep -q "$session"; then
        screen -S "$session" -X quit
        echo "🛑 Stopped $session"
    else
        echo "–  $session not running"
    fi
done
