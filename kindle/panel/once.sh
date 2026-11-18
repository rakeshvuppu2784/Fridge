#!/bin/sh
# KUAL "test" entry: fetch and show the image once, without stopping the reader UI or sleeping
DIR="$(cd "$(dirname "$0")" && pwd)"; . "$DIR/local.sh"
if curl -fsS -m 45 -o "$DIR/test.png" "$PANEL_URL?t=$(date +%s)" 2>"$DIR/test.err" || wget -q -T 45 -O "$DIR/test.png" "$PANEL_URL" 2>>"$DIR/test.err"; then
  eips -f -g "$DIR/test.png"
else
  eips 1 35 " Test failed - see panel/test.err "
fi
