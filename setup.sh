#!/usr/bin/env bash
# Token Meter setup: installs everything that depends on where this repo lives.
#   - a Python venv (.venv) with PySide6
#   - native-messaging host manifest, for every Chromium-family browser found
#   - XDG autostart entry for the widget
# Safe to re-run. Usage: ./setup.sh [--no-autostart]
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
HOST_NAME="com.tokenmeter.claude_usage"
TEMPLATE="$REPO/native_host/$HOST_NAME.json"
AUTOSTART=1
[[ "${1:-}" == "--no-autostart" ]] && AUTOSTART=0

[[ "$(uname -s)" == "Linux" ]] || { echo "setup.sh supports Linux only." >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required." >&2; exit 1; }

# --- 1. Python venv + PySide6 -------------------------------------------
echo "==> Setting up Python venv"
if [[ ! -x "$REPO/.venv/bin/python" ]]; then
  python3 -m venv "$REPO/.venv" || {
    echo "venv creation failed (on Debian/Ubuntu: sudo apt install python3-venv)." >&2
    exit 1
  }
fi
"$REPO/.venv/bin/pip" install --quiet --upgrade pip PySide6

# --- 2. Native messaging manifest ---------------------------------------
echo "==> Installing native messaging manifest"
chmod +x "$REPO/native_host/host.py" "$REPO/widget/run.sh"

# Render the manifest with this clone's real host.py path (the tracked
# template is left untouched). Extension ID/allowed_origins are unchanged:
# the ID is fixed by the "key" field in extension/manifest.json.
RENDERED="$(mktemp)"
trap 'rm -f "$RENDERED"' EXIT
python3 - "$TEMPLATE" "$REPO/native_host/host.py" >"$RENDERED" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
m["path"] = sys.argv[2]
print(json.dumps(m, indent=2))
PY

# browser config dirs (only installed if the browser has been run before)
CONFIG_DIRS=(
  "$HOME/.config/chromium"
  "$HOME/.config/google-chrome"
  "$HOME/.config/google-chrome-beta"
  "$HOME/.config/google-chrome-unstable"
  "$HOME/.config/BraveSoftware/Brave-Browser"
  "$HOME/.config/microsoft-edge"
  "$HOME/.config/vivaldi"
  # snap Chromium ignores ~/.config/chromium and uses its own profile dir
  "$HOME/snap/chromium/common/chromium"
)

installed=0
for dir in "${CONFIG_DIRS[@]}"; do
  [[ -d "$dir" ]] || continue
  mkdir -p "$dir/NativeMessagingHosts"
  cp "$RENDERED" "$dir/NativeMessagingHosts/$HOST_NAME.json"
  echo "    installed: $dir/NativeMessagingHosts/"
  installed=$((installed + 1))
done
if [[ $installed -eq 0 ]]; then
  echo "    No supported browser profile found. Run your browser once, then re-run ./setup.sh." >&2
  echo "    (Flatpak browsers are not supported: the sandbox can't reach the host script.)" >&2
fi

# --- 3. Autostart --------------------------------------------------------
if [[ $AUTOSTART -eq 1 ]]; then
  echo "==> Installing autostart entry"
  mkdir -p "$HOME/.config/autostart"
  cat >"$HOME/.config/autostart/token-meter-widget.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Token Meter
Comment=Always-on-top Claude usage overlay
Exec=$REPO/widget/run.sh
Icon=$REPO/extension/icons/icon128.png
Terminal=false
X-GNOME-Autostart-enabled=true
DESKTOP
fi

cat <<DONE

Done. Remaining manual steps:
  1. Install the extension (see README "One-time setup"): drag dist/token-meter.crx
     onto chrome://extensions (Developer mode on), or "Load unpacked" extension/.
  2. Sign in to https://claude.ai in that browser.
  3. Start the widget: setsid $REPO/widget/run.sh >/dev/null 2>&1 &
DONE
