#!/usr/bin/env bash
# The committed index.html is exactly what build/make-play-page.py makes from the committed inputs
# (build/input/game-public.html and src/byok.js, through build/flow_edits.py). Exit 1 on any difference.
set -u
here="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)" || { echo "FAILED rebuild-check: mktemp"; exit 1; }
trap 'rm -rf "$tmp"' EXIT
"${PYTHON:-python3}" "$here/build/make-play-page.py" "$tmp/index.html" >/dev/null || { echo "FAILED rebuild-check: the builder failed"; exit 1; }
if cmp -s "$tmp/index.html" "$here/index.html"; then
  echo "OK rebuild-check"
else
  echo "FAILED rebuild-check: index.html differs from a fresh build"
  cmp "$tmp/index.html" "$here/index.html" | head -1
  exit 1
fi
