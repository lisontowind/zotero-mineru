#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

VERSION="$(
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' manifest.json | head -n1
)"

if [[ -z "${VERSION}" ]]; then
  echo "Failed to read version from manifest.json" >&2
  exit 1
fi

OUT_FILE="zotero-mineru-${VERSION}.xpi"

FILES=(
  manifest.json
  bootstrap.js
  mineru.js
  preferences.js
  preferences.xhtml
  preferences.css
  prefs.js
  icon.svg
  icon16.svg
  locale
)

rm -f "$OUT_FILE"
bsdtar --format zip -cf "$OUT_FILE" "${FILES[@]}"

echo "Built: $ROOT_DIR/$OUT_FILE"
file "$OUT_FILE"
