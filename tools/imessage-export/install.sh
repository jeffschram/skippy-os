#!/bin/bash
# Sets up the background job that exports recent messages for Skippy's
# ingestion pass: ten minutes before each pass, and once right now.
#
# It installs one per-user launch agent and nothing else. To remove it:
#   tools/imessage-export/install.sh --remove
set -euo pipefail
label="app.skippyos.imessage-export"
binary="$HOME/.skippy-os/bin/skippy-imessage-export"
plist="$HOME/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"

launchctl bootout "$domain/$label" 2>/dev/null || true
if [ "${1:-}" = "--remove" ]; then
  rm -f "$plist"
  echo "Removed the Messages export job. The exporter and its last export are still in ~/.skippy-os."
  exit 0
fi

[ -x "$binary" ] || { echo "The exporter is not built yet. Run tools/imessage-export/build.sh first."; exit 1; }
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.skippy-os/imessage"
chmod 700 "$HOME/.skippy-os/imessage"

times=""
for hour in 8 10 12 14 16 18; do
  times="$times    <dict><key>Hour</key><integer>$hour</integer><key>Minute</key><integer>50</integer></dict>
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
    <string>$binary</string>
    <string>--days</string>
    <string>7</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
$times  </array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/.skippy-os/imessage/export.log</string>
  <key>StandardErrorPath</key><string>$HOME/.skippy-os/imessage/export.log</string>
</dict>
</plist>
PLIST
launchctl bootstrap "$domain" "$plist"
sleep 2
echo "Installed. The job's last word:"
tail -1 "$HOME/.skippy-os/imessage/export.log" 2>/dev/null || echo "(nothing yet)"
