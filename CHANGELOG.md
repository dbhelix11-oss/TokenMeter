# Changelog

## 2026-08-07

- Initial version: always-on-top desktop overlay for Claude usage (5-hour
  and weekly %, reset countdowns).
- Forked the "Claude Usage Meter" browser extension to push its fetched
  usage data out via Chrome Native Messaging instead of only rendering it
  in a popup.
- Added a native messaging host (`native_host/host.py`) that relays the
  pushed data to a local `status.json` file.
- Added a PySide6 overlay widget (`widget/overlay.py`) that reads that
  file and renders a draggable, always-on-top meter with live countdowns
  and a stale-data indicator.
- Added XDG autostart entry so the widget launches on login.
