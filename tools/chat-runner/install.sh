#!/bin/bash
# Sets up the chat runner as a background job on this Mac, so dashboard chats
# are answered whenever the mini is on. It installs one per-user launch agent.
#
# To remove it:  tools/chat-runner/install.sh --remove
set -euo pipefail
label="app.skippyos.chat-runner"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
plist="$HOME/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"
log="$HOME/.skippy-os/chat-runner.log"

launchctl bootout "$domain/$label" 2>/dev/null || true
if [ "${1:-}" = "--remove" ]; then
  rm -f "$plist"
  echo "Removed the chat runner. Messages sent in a dashboard chat will wait until it runs again."
  exit 0
fi

[ -f "$HOME/.skippy-os/runner.env" ] || { echo "~/.skippy-os/runner.env is missing. See docs/chat-runner.md."; exit 1; }
node="$(command -v node)"
claude="$(command -v claude)"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$node</string>
    <string>$repo/tools/chat-runner/runner.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$repo</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$node"):$(dirname "$claude"):/usr/bin:/bin</string>
    <key>SKIPPY_CLAUDE_BIN</key><string>$claude</string>
  </dict>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$log</string>
  <key>StandardErrorPath</key><string>$log</string>
</dict>
</plist>
PLIST
launchctl bootstrap "$domain" "$plist"
sleep 3
echo "Installed. The runner's last word:"
tail -1 "$log" 2>/dev/null || echo "(nothing yet)"
