#!/bin/bash
# Sets up the scheduled ingestion passes on this Mac: six a day, at 9am, 11am,
# 1pm, 3pm, 5pm and 7pm. It installs one per-user launch agent.
#
# To remove it:  tools/ingest/install.sh --remove
set -euo pipefail
label="app.skippyos.ingest"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
plist="$HOME/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"
log="$HOME/.skippy-os/ingest/passes.log"

launchctl bootout "$domain/$label" 2>/dev/null || true
if [ "${1:-}" = "--remove" ]; then
  rm -f "$plist"
  echo "Removed the scheduled ingestion passes. Nothing is read until they are installed again."
  exit 0
fi

node="$(command -v node)"
claude="$(command -v claude)"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.skippy-os/ingest"
times=""
for hour in 9 11 13 15 17 19; do
  times="$times    <dict><key>Hour</key><integer>$hour</integer><key>Minute</key><integer>0</integer></dict>
"
done
cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$node</string>
    <string>$repo/tools/ingest/pass.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$repo</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$node"):$(dirname "$claude"):/usr/bin:/bin</string>
    <key>SKIPPY_CLAUDE_BIN</key><string>$claude</string>
  </dict>
  <key>StartCalendarInterval</key>
  <array>
$times  </array>
  <key>StandardOutPath</key><string>$log</string>
  <key>StandardErrorPath</key><string>$log</string>
</dict>
</plist>
PLIST
launchctl bootstrap "$domain" "$plist"
echo "Installed. Passes run at 9am, 11am, 1pm, 3pm, 5pm and 7pm. Their log is $log"
echo "To run one now:  node tools/ingest/pass.mjs"
