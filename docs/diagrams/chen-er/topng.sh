#!/bin/sh
# usage: topng.sh in.svg out.png   (renders at 2x with headless Chrome; no Graphviz/rsvg needed)
set -e
SVG=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
OUT=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
VB=$(grep -o 'viewBox="[^"]*"' "$SVG" | head -1 | tr -d '"' | cut -d= -f2)
W=$(echo $VB | awk '{print int($3)+1}'); H=$(echo $VB | awk '{print int($4)+1}')
TMP=$(mktemp -d); HTML="$TMP/page.html"
# graphviz emits width/height in pt; force the viewBox size in px so Chrome does not scale it
BODY=$(W=$W H=$H perl -0pe 's/<svg width="[^"]*" height="[^"]*"/<svg width="$ENV{W}px" height="$ENV{H}px"/' "$SVG")
printf '<html><body style="margin:0;background:#fff">%s</body></html>' "$BODY" > "$HTML"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=$W,$H --screenshot="$OUT" "file://$HTML" 2>/dev/null
rm -rf "$TMP"
echo "$OUT ${W}x${H} @2x"
