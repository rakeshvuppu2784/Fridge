#!/bin/sh
# KUAL entry point: run the panel loop in the background, detached from KUAL
DIR="$(cd "$(dirname "$0")" && pwd)"
[ -f "$DIR/local.sh" ] || { eips 1 35 " kindle-panel: local.sh missing " ; exit 1; }
pkill -f "$DIR/panel.sh" 2>/dev/null
nohup sh "$DIR/panel.sh" >/dev/null 2>&1 &
