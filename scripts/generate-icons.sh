#!/usr/bin/env bash
set -euo pipefail

src="icons/icon-128.png"
if [ ! -f "$src" ]; then
  echo "Missing $src. Drop a 128x128 PNG there before building." >&2
  exit 1
fi

if command -v magick >/dev/null 2>&1; then
  image_command=magick
else
  image_command=convert
fi

for size in 16 32 48; do
  "$image_command" "$src" -resize "${size}x${size}" "icons/icon-${size}.png"
done
