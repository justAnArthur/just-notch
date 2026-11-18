#!/bin/sh
# Signs a release zip with Sparkle's EdDSA key and prints the appcast for it: one item, this release.
# usage: appcast.sh <sign_update> <ed-key-file> <zip> <version> <build> > appcast.xml
# The feed is a release asset (releases/latest/download/appcast.xml), so each release's appcast names only itself.
set -eu

sign_update=$1 key=$2 zip=$3 version=$4 build=$5
repo=https://github.com/justAnArthur/just-notch
tag="just-notch%40$version"

# `sparkle:edSignature="…" length="…"`
signature=$("$sign_update" --ed-key-file "$key" "$zip")

cat <<EOF
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Just Notch</title>
    <link>$repo</link>
    <item>
      <title>Just Notch $version</title>
      <pubDate>$(LC_ALL=C date -u '+%a, %d %b %Y %H:%M:%S +0000')</pubDate>
      <sparkle:version>$build</sparkle:version>
      <sparkle:shortVersionString>$version</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>
      <sparkle:releaseNotesLink>$repo/releases/tag/$tag</sparkle:releaseNotesLink>
      <sparkle:fullReleaseNotesLink>$repo/releases</sparkle:fullReleaseNotesLink>
      <enclosure url="$repo/releases/download/$tag/$(basename "$zip")" type="application/octet-stream" $signature/>
    </item>
  </channel>
</rss>
EOF
