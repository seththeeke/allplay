#!/bin/sh
# Builds backend/.local/AllPlaySpeech.app from transcribe.swift (local-development.md section 4).
set -e
here="$(cd "$(dirname "$0")" && pwd)"
app="$here/../../../.local/AllPlaySpeech.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
cp "$here/Info.plist" "$app/Contents/Info.plist"
swiftc -O "$here/transcribe.swift" -o "$app/Contents/MacOS/allplay-macos-speech"
xattr -cr "$app"
codesign --force --sign - "$app"
echo "Built $app"
