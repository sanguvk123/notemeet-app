#!/bin/bash
set -e
export PATH="/Users/sangameshk/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$HOME/.cargo/bin:$PATH"

BUILT_APP="/Users/sangameshk/notemeet-app/src-tauri/target/release/bundle/macos/NoteMeet.app"
INSTALLED_APP="/Applications/NoteMeet.app"
PLIST="$BUILT_APP/Contents/Info.plist"

# Kill running instance
pkill -x NoteMeet 2>/dev/null || true

# Load secrets from .env
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# Build
npm run tauri build 2>&1 | tail -3 || true

# Patch Info.plist with mic permission
if [ -f "$PLIST" ]; then
  /usr/libexec/PlistBuddy -c "Add NSMicrophoneUsageDescription string 'NoteMeet needs microphone access to record your meetings.'" "$PLIST" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Set NSMicrophoneUsageDescription 'NoteMeet needs microphone access to record your meetings.'" "$PLIST"
fi

# Update /Applications in-place (rsync overwrites contents, no duplicate)
if [ -d "$INSTALLED_APP" ]; then
  rsync -a --delete "$BUILT_APP/" "$INSTALLED_APP/"
else
  cp -R "$BUILT_APP" "$INSTALLED_APP"
fi

open "$INSTALLED_APP"
