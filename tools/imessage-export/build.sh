#!/bin/bash
# Builds the Messages exporter and puts it where the background job runs it.
#
# macOS ties Full Disk Access to this exact build. After running this, the
# exporter has to be removed from and added back to System Settings, Privacy &
# Security, Full Disk Access. So only rebuild when main.swift has changed.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HOME/.skippy-os/bin"
swiftc -O "$here/main.swift" -o "$HOME/.skippy-os/bin/skippy-imessage-export"
echo "Built $HOME/.skippy-os/bin/skippy-imessage-export"
echo "Now give it Full Disk Access again: remove it from the list and add it back."
