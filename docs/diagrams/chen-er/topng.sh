#!/bin/sh
# usage: topng.sh in.svg out.png   (renders at 2x)
SVG=$1; OUT=$2
VB=$(grep -o 'viewBox="[^"]*"' "$SVG" | head -1 | tr -d '"' | cut -d= -f2)
W=$(echo $VB | awk '{print int($3)+1}'); H=$(echo $VB | awk '{print int($4)+1}')
HTML="${OUT%.png}.html"
W=$W H=$H perl -0pe 's/<svg width="[^"]*" height="[^"]*"/<svg width="$ENV{W}px" height="$ENV{H}px"/' "$SVG" > "$HTML.svg"
printf '<html><body style="margin:0;background:#fff">%s</body></html>' "$(cat "$HTML.svg")" > "$HTML"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=$W,$H --screenshot="$OUT" "file://$HTML" 2>/dev/null
echo "$OUT $W x $H"
