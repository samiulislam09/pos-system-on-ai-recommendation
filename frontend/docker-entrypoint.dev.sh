#!/bin/sh
# node_modules and .next live in named volumes (see docker-compose.yml). Docker
# seeds a named volume from the image only when the volume is first created;
# after that it shadows whatever later image builds installed. A volume that
# drifts from the current package-lock.json (new deps, partial first seed,
# manual installs inside the container) makes Turbopack fail while evaluating
# postcss.config.mjs:
#
#     Error evaluating Node.js code
#     Cannot find module as expression is too dynamic
#
# The image build writes an md5 stamp of the lockfile it installed from into
# node_modules; if the stamp in the volume doesn't match the (bind-mounted)
# lockfile, reinstall and drop the Turbopack cache, which holds chunks compiled
# against the old module graph. `set -e` aborts the start rather than launching
# next dev on a half-installed tree if npm ci fails.
set -e

STAMP=/app/node_modules/.package-lock.md5
CURRENT=$(md5sum /app/package-lock.json | cut -d' ' -f1)

if [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$CURRENT" ]; then
  echo "[web] node_modules volume does not match package-lock.json; running npm ci (first start after a dependency change, takes a few minutes)..."
  npm ci
  # /app/.next is a mount point and cannot itself be removed; empty it instead.
  find /app/.next -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  echo "$CURRENT" > "$STAMP"
fi

exec "$@"
