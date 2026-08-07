#!/usr/bin/env bash
#
# Build the Chrome Web Store upload package.
#
#   ./scripts/package.sh
#
# Produces dist/form-seeder-<version>.zip, where <version> is read from
# manifest.json. Only the files Chrome actually loads go in — the zip is built
# from an explicit allow-list rather than by excluding things, so a new stray
# file in the repo root can never leak into a published package.
#
# Requires: zip, python3 (only to read the version out of manifest.json).

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

# Everything the extension loads at runtime. manifest.json first, by convention.
# Directories are included whole; add new runtime files here.
PAYLOAD=(
  manifest.json
  popup.html
  popup.js
  options.html
  options.js
  lib
  vendor
  icons
  LICENSE
)

VERSION="$(python3 -c 'import json,sys; print(json.load(open("manifest.json"))["version"])')"
OUT="$ROOT/dist/form-seeder-${VERSION}.zip"

for path in "${PAYLOAD[@]}"; do
  [[ -e "$path" ]] || { echo "package.sh: missing $path" >&2; exit 1; }
done

mkdir -p "$ROOT/dist"
rm -f "$OUT"

# -r recurse, -X drop macOS extended attributes, and prune the cruft that
# survives inside directories (.DS_Store, editor swap files).
zip -r -X "$OUT" "${PAYLOAD[@]}" \
  -x '*.DS_Store' -x '__MACOSX/*' -x '*.swp' -x '*~' >/dev/null

echo "$OUT"
# BSD head has no -n -2, so filter the zip listing's header/footer by shape.
unzip -l "$OUT" | awk 'NF==4 && $1 ~ /^[0-9]+$/ { print "  " $4 }'
echo
echo "Size: $(du -h "$OUT" | cut -f1)"
