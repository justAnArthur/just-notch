#!/bin/sh
# Renders assets/brand/icon-1024.png into the AppIcon set (16–512 pt at @1x and @2x).
# Run it after the icon master changes and commit the result.
set -eu

MACOS="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$MACOS/../../assets/brand/icon-1024.png"
CATALOG="$MACOS/JustNotch/Assets.xcassets"
SET="$CATALOG/AppIcon.appiconset"

mkdir -p "$SET"
rm -f "$SET"/*.png

cat > "$CATALOG/Contents.json" <<'JSON'
{
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
JSON

images=""
for size in 16 32 128 256 512; do
  for scale in 1 2; do
    px=$((size * scale))
    suffix=""
    [ "$scale" = 1 ] || suffix="@2x"
    name="icon_${size}x${size}$suffix.png"
    sips -z "$px" "$px" "$SRC" --out "$SET/$name" >/dev/null
    images="$images${images:+,
}    {
      \"filename\" : \"$name\",
      \"idiom\" : \"mac\",
      \"scale\" : \"${scale}x\",
      \"size\" : \"${size}x${size}\"
    }"
  done
done

cat > "$SET/Contents.json" <<JSON
{
  "images" : [
$images
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
JSON
