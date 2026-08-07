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
- Fixed native messaging host writes silently failing under Chromium's snap
  sandbox: `host.py` now resolves the real home directory via the passwd
  database (snap rewrites `HOME` for spawned processes) and writes to a
  plain top-level `~/token-meter/` directory instead of the hidden
  `~/.local/share/token-meter/`, which snap's AppArmor profile blocks for
  arbitrary new subpaths.
- Sped up the extension's background refresh from every 10 minutes to every
  1 minute, and made the refresh alarm re-create itself unconditionally on
  every script load so a manual extension reload always picks up interval
  changes.
- Added a "Recent Tasks" section to the overlay showing the 5 most recently
  active Claude Code CLI sessions and their cumulative token usage, read
  directly from local session transcripts (`widget/task_tracker.py`) —
  independent of the browser/extension pipeline.
