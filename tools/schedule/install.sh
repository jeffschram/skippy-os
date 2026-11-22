#!/bin/bash
# Sets up two background jobs on this Mac:
#   the nightly sweep of code projects, at 3:30 each morning
#   the weekly review, at 6pm each Sunday
#
# To remove them:  tools/schedule/install.sh --remove
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
domain="gui/$(id -u)"
agents="$HOME/Library/LaunchAgents"

for job in sweep review; do
  launchctl bootout "$domain/app.skippyos.$job" 2>/dev/null || true
done
if [ "${1:-}" = "--remove" ]; then
  rm -f "$agents/app.skippyos.sweep.plist" "$agents/app.skippyos.review.plist"
  echo "Removed the nightly sweep and the weekly review."
  exit 0
fi

node="$(command -v node)"
claude="$(command -v claude)"
mkdir -p "$agents" "$HOME/.skippy-os/sweep" "$HOME/.skippy-os/review"

write_job() { # name, script, the <dict> that says when
  cat > "$agents/app.skippyos.$1.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>app.skippyos.$1</string>
  <key>ProgramArguments</key>
  <array>
    <string>$node</string>
    <string>$repo/tools/schedule/$2</string>
  </array>
  <key>WorkingDirectory</key><string>$repo</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$node"):$(dirname "$claude"):/usr/bin:/bin</string>
    <key>SKIPPY_CLAUDE_BIN</key><string>$claude</string>
  </dict>
  <key>StartCalendarInterval</key>
  $3
  <key>StandardOutPath</key><string>$HOME/.skippy-os/$1/$1.log</string>
  <key>StandardErrorPath</key><string>$HOME/.skippy-os/$1/$1.log</string>
</dict>
</plist>
PLIST
  launchctl bootstrap "$domain" "$agents/app.skippyos.$1.plist"
}

write_job sweep sweep.mjs "<dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>"
write_job review review.mjs "<dict><key>Weekday</key><integer>0</integer><key>Hour</key><integer>18</integer><key>Minute</key><integer>0</integer></dict>"
echo "Installed. The sweep runs at 3:30 each morning, the review at 6pm each Sunday."
echo "To run either now:  node tools/schedule/sweep.mjs   or   node tools/schedule/review.mjs"
