#!/usr/bin/env bash
# The committed pages are exactly what the build makes from the committed source: index.html from src/game.html and
# src/byok.js (build/make-play-page.py), and the preview, wip.html and guide/wip.html, from index.html and
# guide/index.html (build/make-wip-page.py). Exit 1 on any difference.
set -u
here="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)" || { echo "FAILED rebuild-check: mktemp"; exit 1; }
trap 'rm -rf "$tmp"' EXIT
"${PYTHON:-python3}" "$here/build/make-play-page.py" "$tmp/index.html" >/dev/null || { echo "FAILED rebuild-check: the builder failed"; exit 1; }
"${PYTHON:-python3}" "$here/build/make-wip-page.py" "$tmp" >/dev/null || { echo "FAILED rebuild-check: the preview builder failed"; exit 1; }
bad=0; seen=0
for f in index.html wip.html guide/wip.html; do
  [ -s "$tmp/$f" ] || { echo "FAILED rebuild-check: the build wrote no $f"; exit 1; }
  seen=$((seen + 1))
  if ! cmp -s "$tmp/$f" "$here/$f"; then
    echo "FAILED rebuild-check: $f differs from a fresh build"
    cmp "$tmp/$f" "$here/$f" | head -1
    bad=1
  fi
done
[ "$bad" -eq 0 ] && [ "$seen" -eq 3 ] || exit 1
echo "OK rebuild-check (index.html, wip.html, guide/wip.html)"
