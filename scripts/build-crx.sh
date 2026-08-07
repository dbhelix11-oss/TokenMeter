#!/usr/bin/env bash
# Rebuilds dist/token-meter.crx from extension/ using the private key in
# keys/token-meter-extension.pem. Run this after any change under extension/.
#
# The .pem is never committed (see .gitignore) — losing it means a rebuild
# gets a *different* extension ID, which breaks the native-messaging
# allowlist in native_host/com.tokenmeter.claude_usage.json until that file
# (and the two installed copies under ~/.config/chromium and
# ~/snap/chromium/common/chromium) are updated to match the new ID.
set -euo pipefail
cd "$(dirname "$0")/.."

KEY=keys/token-meter-extension.pem
if [ ! -f "$KEY" ]; then
  echo "error: $KEY not found — this key is required to keep the extension ID stable." >&2
  exit 1
fi

CHROMIUM_BIN="${CHROMIUM_BIN:-/snap/bin/chromium}"
"$CHROMIUM_BIN" --pack-extension=extension --pack-extension-key="$KEY" --no-sandbox

mkdir -p dist
mv extension.crx dist/token-meter.crx
echo "built dist/token-meter.crx"
