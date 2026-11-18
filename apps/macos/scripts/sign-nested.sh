#!/usr/bin/env bash
# Re-signs a built JustNotch.app inside out with one identity: Sparkle's helpers, its framework, then
# the app (keeping its entitlements). Xcode's Code Sign On Copy re-signs only the framework itself and
# leaves the helpers inside it ad-hoc signed as Sparkle ships them.
#
#   scripts/sign-nested.sh <JustNotch.app> <identity> [keychain]
#
# Order and flags follow Sparkle's "Code signing" guide.
set -euo pipefail

app="$1"
identity="$2"
sign=(codesign --force --timestamp=none --options runtime --sign "$identity")
[ -n "${3:-}" ] && sign+=(--keychain "$3")

sparkle="$app/Contents/Frameworks/Sparkle.framework"
"${sign[@]}" "$sparkle/Versions/B/XPCServices/Installer.xpc"
"${sign[@]}" --preserve-metadata=entitlements "$sparkle/Versions/B/XPCServices/Downloader.xpc"
"${sign[@]}" "$sparkle/Versions/B/Autoupdate"
"${sign[@]}" "$sparkle/Versions/B/Updater.app"
"${sign[@]}" "$sparkle"
"${sign[@]}" --preserve-metadata=entitlements "$app"

codesign --verify --deep --strict "$app"
