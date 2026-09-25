#!/usr/bin/env bash
# Export a Markdown document (including its Mermaid diagrams) to a PDF, using the
# Google Chrome installed on this Mac. Needs an internet connection: the page loads
# the Markdown and Mermaid libraries from cdn.jsdelivr.net.
#
# Usage (from anywhere):
#   bash docs/export-pdf.sh                       # exports database-schema-simple.md
#   bash docs/export-pdf.sh database-schema.md    # any .md file in the docs folder
#
# The PDF is saved next to the .md file, with the same name, and opened when done.
set -euo pipefail

cd "$(dirname "$0")"
MD="${1:-database-schema-simple.md}"
OUT="$PWD/${MD%.md}.pdf"

if [ ! -f "$MD" ]; then
  echo "Can't find $MD in $PWD" >&2
  exit 1
fi
if grep -qi '</script' "$MD"; then
  echo "$MD contains '</script', which this script can't embed safely." >&2
  exit 1
fi

CHROME=""
for c in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"; do
  if [ -x "$c" ]; then CHROME="$c"; break; fi
done
if [ -z "$CHROME" ]; then
  echo "Google Chrome (or Chromium / Edge) is needed. Install it from google.com/chrome." >&2
  exit 1
fi

TMP="$(mktemp -t schema-print)"
HTML="$TMP.html"
trap 'rm -f "$TMP" "$HTML"' EXIT

{
cat <<'HEAD'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Database schema</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font: 11pt/1.45 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1c1f1e; margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 8pt; }
  h2 { font-size: 15pt; margin: 18pt 0 6pt; break-after: avoid; }
  h3 { font-size: 12.5pt; margin: 14pt 0 6pt; break-after: avoid; }
  p, li { max-width: 62em; }
  a { color: inherit; }
  code { font: 0.92em Menlo, Consolas, monospace; background: #eef1f0; padding: 0 2pt; border-radius: 2pt; }
  pre { font: 9pt/1.25 Menlo, Consolas, monospace; background: #f6f8f7; border: 1px solid #d6dcda;
        padding: 8pt; white-space: pre; overflow: visible; }
  pre code { background: none; padding: 0; font-size: inherit; }
  hr { border: 0; border-top: 1px solid #cfd6d3; margin: 16pt 0; }
  details > summary { font-weight: 600; margin: 8pt 0; list-style: none; }
  .mermaid { margin: 8pt 0; }
  .mermaid svg { max-width: 100% !important; height: auto; }
</style>
</head>
<body>
<main id="content"></main>
<script id="md" type="text/plain">
HEAD
cat "$MD"
cat <<'TAIL'
</script>
<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js"></script>
<script>
  const source = document.getElementById("md").textContent;
  document.getElementById("content").innerHTML = marked.parse(source);
  // Print collapsed sections expanded.
  document.querySelectorAll("details").forEach((d) => { d.open = true; });
  // Turn ```mermaid code blocks into diagrams.
  document.querySelectorAll("code.language-mermaid").forEach((code) => {
    const div = document.createElement("div");
    div.className = "mermaid";
    div.textContent = code.textContent;
    code.parentElement.replaceWith(div);
  });
  const h1 = document.querySelector("h1");
  if (h1) document.title = h1.textContent;
  mermaid.initialize({ startOnLoad: false, theme: "default" });
  mermaid.run();
</script>
</body>
</html>
TAIL
} > "$HTML"

echo "Rendering $MD with Chrome..."
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer \
  --virtual-time-budget=20000 --print-to-pdf="$OUT" "file://$HTML" 2>/dev/null

if [ -s "$OUT" ]; then
  echo "Saved: $OUT"
  open "$OUT"
else
  echo "Chrome didn't produce a PDF. Check your internet connection and try again." >&2
  exit 1
fi
