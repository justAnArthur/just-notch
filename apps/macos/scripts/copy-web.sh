#!/bin/sh
# Copies the runtime build and the default plugins into the app bundle's Resources/Web.
# Never fails on missing inputs: without packages/runtime/dist a placeholder page is written.
set -eu

ROOT="${SRCROOT:-$(cd "$(dirname "$0")/.." && pwd)}/../.."
DEST="${TARGET_BUILD_DIR:?}/${UNLOCALIZED_RESOURCES_FOLDER_PATH:?}/Web"
RUNTIME="$ROOT/packages/runtime/dist"

rm -rf "$DEST"
mkdir -p "$DEST/plugins"

if [ -d "$RUNTIME" ]; then
  rsync -a "$RUNTIME/" "$DEST/"
else
  echo "warning: $RUNTIME is missing, bundling a placeholder page"
  cp "$SRCROOT/scripts/placeholder.html" "$DEST/index.html"
fi

for plugin in "$ROOT"/plugins/*/; do
  [ -f "$plugin/manifest.json" ] && [ -d "$plugin/dist" ] || continue
  id="$(basename "$plugin")"
  mkdir -p "$DEST/plugins/$id"
  cp "$plugin/manifest.json" "$DEST/plugins/$id/"
  rsync -a "$plugin/dist" "$DEST/plugins/$id/"
done
