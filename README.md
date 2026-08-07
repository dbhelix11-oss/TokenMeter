# Token Meter

Always-on-top desktop overlay showing your Claude usage (5-hour session %
and weekly %, with reset countdowns) without needing to open a browser tab.

## How it works

```
Chromium (Claude Usage Meter extension)
  -> fetches claude.ai/api/organizations/{id}/usage using your existing
     browser session (same as the extension always did)
  -> pushes the result over Chrome Native Messaging to native_host/host.py
       native_host/host.py
  -> writes ~/.local/share/token-meter/status.json
       widget/overlay.py (PySide6, always-on-top, frameless)
  -> reads that file every few seconds and renders it
```

Nothing outside the browser ever touches your claude.ai session
cookie/credentials — the widget is a dumb renderer of a local file.

## One-time setup

1. Open `chromium://extensions`, enable **Developer mode**.
2. If you previously loaded the original Claude Usage Meter unpacked,
   remove it.
3. Click **Load unpacked** and select `TokenMeter/extension/`.
4. Make sure you're signed in to https://claude.ai in that browser.

That's it — the extension will refresh every ~10 minutes and push data to
the widget automatically. Keep Chromium running (it doesn't need to be
focused or have a claude.ai tab open) for updates to keep flowing.

## Running the widget

Already started for this session. It also autostarts on login via
`~/.config/autostart/token-meter-widget.desktop`.

- Drag it anywhere; position is remembered.
- Right-click for Refresh / Quit.
- If it says "waiting for extension…" or "stale", make sure Chromium is
  running and you're signed in to claude.ai.

To start it manually: `./widget/run.sh`
