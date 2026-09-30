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
  -> writes ~/token-meter/status.json
       widget/overlay.py (PySide6, always-on-top, frameless)
  -> reads that file every few seconds and renders it
```

Nothing outside the browser ever touches your claude.ai session
cookie/credentials — the widget is a dumb renderer of a local file.

## Credits

The browser extension in [`extension/`](extension/) is a fork of
[Nachtalb/claude-usage-meter](https://github.com/Nachtalb/claude-usage-meter),
licensed under [LGPL-3.0](extension/LICENSE). All credit for the original
popup UI, the claude.ai usage-fetching logic, and the toolbar badge goes to
its author, Nachtalb — this project adds a Chrome Native Messaging push
(`background.js`) so a local process can read that data outside the browser,
and builds the native host (`native_host/`) and desktop overlay
(`widget/`) around it. `extension/manifest.json` keeps the original
`author`/`homepage_url` fields intact, and the upstream `LICENSE`,
`README.md`, and `PRIVACY.md` ship unmodified alongside the fork.

Everything outside `extension/` (`native_host/`, `widget/`, `scripts/`) is
original code for this project.

## One-time setup

First run `./setup.sh` from the repo root. It creates the `.venv` with PySide6,
installs the native-messaging manifest (with this clone's real path) for every
Chromium-family browser it finds — including snap Chromium — and adds the
autostart entry (`--no-autostart` to skip). Safe to re-run, e.g. after moving
the repo. Then install the extension:

Two ways to install the extension — pick one.

**Option A — packaged .crx (recommended once built):**

1. Open `chromium://extensions`, enable **Developer mode**.
2. Drag `dist/token-meter.crx` onto the page and confirm the install
   prompt.

**Option B — load unpacked (for actively editing the extension code):**

1. Open `chromium://extensions`, enable **Developer mode**.
2. Click **Load unpacked** and select `TokenMeter/extension/`.

Either way, remove any old/duplicate copy first — the extension's ID comes
from the `"key"` field in `extension/manifest.json`, so both install
methods get the *same* stable ID
(`mebojcnaecoalmocdfeoiofjgdflpbhl`) as long as that field is unchanged,
but two simultaneous copies will still conflict.

Then make sure you're signed in to https://claude.ai in that browser.
That's it — the extension refreshes every ~1 minute and pushes data to the
widget automatically. Keep Chromium running (it doesn't need to be
focused or have a claude.ai tab open) for updates to keep flowing.

### Rebuilding the .crx after editing the extension

```
./scripts/build-crx.sh
```

This signs with the private key in `keys/token-meter-extension.pem`
(generated locally, never committed — see `.gitignore`). Losing that key
means a rebuild gets a *different* extension ID, which breaks the
native-messaging allowlist in
`native_host/com.tokenmeter.claude_usage.json` (and its two installed
copies under `~/.config/chromium/NativeMessagingHosts/` and
`~/snap/chromium/common/chromium/NativeMessagingHosts/`) until those are
updated to match.

### API credit meter (optional)

Separate from the two meters above — those track a claude.ai Pro/Max
subscription's rate-limit windows via the browser extension. This one
tracks $ spent against a pay-as-you-go **API** account (e.g. what Claude
Code draws from if it's configured with an API key instead of a
subscription login), via Anthropic's official [Usage & Cost Admin
API](https://platform.claude.com/docs/en/api/usage-cost-api). That's an
organization-management endpoint — polling it does not consume Messages-API
tokens/credits.

Anthropic doesn't currently expose an API for your *remaining* prepaid
credit balance, only spend, so this works off a manual snapshot: you note
your current balance and today's date, and the widget tracks spend forward
from there and subtracts.

To enable it:

1. Create an Admin API key (`sk-ant-admin01-...`) — see [Create an Admin API
   key](https://platform.claude.com/docs/en/manage-claude/admin-api-keys).
   This is different from a normal API key and only works for Console
   (pay-as-you-go) organizations, not individual accounts.
2. Note the dollar amount you last **topped up** (e.g. "I added $5.00 to
   the account"), and the date you did that top-up — not your current
   remaining balance. The widget computes remaining balance itself by
   subtracting spend (from the Cost API) that happened on or after that
   date, so if you enter your *current* balance here it'll get
   double-subtracted.
3. Copy `widget/api_credits_config.example.json` to
   `~/token-meter/api_credits_config.json` and fill in:
   - `admin_api_key` — the key from step 1.
   - `total_purchased_usd` — the top-up amount from step 2 (the full
     amount added, not what's left of it).
   - `since` — the top-up date from step 2 (`YYYY-MM-DD`).

The widget polls every 2 minutes and shows spent/total as a bar, same style
as the other two meters. Update `total_purchased_usd` and `since` any time
you check your balance again (e.g. after topping up) to re-anchor it.
`~/token-meter/api_credits_config.json` lives outside the git repo and is
never read by anything but this widget.

## Running the widget

Already started for this session. It also autostarts on login via
`~/.config/autostart/token-meter-widget.desktop`.

- Drag it anywhere; position is remembered.
- Right-click for Refresh / Quit.
- If it says "waiting for extension…" or "stale", make sure Chromium is
  running and you're signed in to claude.ai.

To start it manually: `./widget/run.sh`

To start it in the background so it survives closing the terminal:

```bash
setsid ./widget/run.sh >/dev/null 2>&1 &
```

(`nohup ./widget/run.sh >/dev/null 2>&1 &` also works. Note `&&` only chains
commands; a single `&` is what backgrounds one.) If it's already running in
the foreground, press `Ctrl+Z`, then run `bg` and `disown`.

## TODO — before a public release

`./setup.sh` now handles the machine-specific paths, venv, native-messaging
manifests and autostart. Still open:

- The extension's signing key (`keys/token-meter-extension.pem`) is
  machine-specific and gitignored by design. A public release needs either
  a documented "generate your own key" step, or an actual Chrome Web Store
  listing so users don't need to self-sign at all.
- `setup.sh` is Linux-only (no macOS/Windows/flatpak support).
