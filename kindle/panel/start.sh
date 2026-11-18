#!/bin/sh
# Entry point (from the "Desk panel - start" scriptlet): run the panel loop detached in the background
DIR="$(cd "$(dirname "$0")" && pwd)"
[ -f "$DIR/local.sh" ] || { eips 1 35 " Desk panel: local.sh missing " ; exit 1; }
pkill -f "$DIR/panel.sh" 2>/dev/null
if command -v setsid >/dev/null 2>&1; then setsid nohup sh "$DIR/panel.sh" >/dev/null 2>&1 < /dev/null &
else nohup sh "$DIR/panel.sh" >/dev/null 2>&1 < /dev/null & fi
