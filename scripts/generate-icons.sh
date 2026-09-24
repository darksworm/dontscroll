#!/usr/bin/env bash
set -euo pipefail

src="icons/icon-128.png"
if [ ! -f "$src" ]; then
  echo "Missing $src. Drop a 128x128 PNG there before building." >&2
  exit 1
fi

for size in 16 32 48; do
  magick "$src" -resize "${size}x${size}" "icons/icon-${size}.png"
done
