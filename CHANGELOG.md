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
- Added packaged `.crx` distribution: generated a new signing key (the
  original was never saved, so its ID was orphaned), rebuilt the extension
  under the new stable ID `mebojcnaecoalmocdfeoiofjgdflpbhl`, updated the
  native-messaging allowlist to match, and added `scripts/build-crx.sh` to
  rebuild `dist/token-meter.crx` after future extension edits. The private
  key stays local (`keys/`, gitignored) — the `.crx` itself carries no
  secrets and is safe to distribute.
- Documented remaining portability gaps (hardcoded native-host path, no
  cross-platform installer, manual venv/autostart setup, per-machine
  signing key) as a TODO list for a future public release.
- Added an "API Credits" meter tracking pay-as-you-go Anthropic API spend
  against a manually-entered credit balance snapshot (`widget/api_credits.py`).
  Polls Anthropic's Admin Cost Report API — an organization-management
  endpoint, so it doesn't consume Messages-API tokens/credits — on a
  background thread every 2 minutes, independent of the browser/extension
  pipeline. Config (Admin API key + balance snapshot) lives at
  `~/token-meter/api_credits_config.json`, outside the repo. Worked around a
  Cost API quirk where date ranges reaching into today are rejected (only
  fully-completed UTC days are queryable).

## 2026-08-09

- Made the repo public. Added a Credits section to the root `README.md`
  crediting [Nachtalb/claude-usage-meter](https://github.com/Nachtalb/claude-usage-meter)
  (LGPL-3.0) as the source of the forked browser extension in `extension/`,
  which already carried its original `LICENSE`, `README.md`, `PRIVACY.md`,
  and `author`/`homepage_url` manifest fields unmodified. Verified no API
  keys or secrets exist anywhere in git history before flipping visibility.

## 2026-08-10

- Clarified the API credit meter setup instructions in `README.md`:
  `total_purchased_usd` is the amount you last topped up (not your current
  remaining balance) and `since` is that top-up's date — entering a current
  balance instead causes spend since `since` to be subtracted twice. This
  was found after a live misconfiguration where a remaining balance was
  entered as `total_purchased_usd`, making the meter read a too-low
  percentage.

## 2026-09-29

- README: documented how to run the widget in the background
  (`setsid`/`nohup` with a single `&`, or `Ctrl+Z` then `bg`/`disown`).
- README: removed a duplicate `nohup` line from the background-run notes.
