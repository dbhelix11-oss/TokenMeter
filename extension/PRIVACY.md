# Privacy Policy

_Last updated: 2026-04-25_

This privacy policy describes how the **Claude Usage Meter** browser extension
(the "Extension") handles information when you use it.

## Summary

The Extension does not collect, sell, share, or transmit any personal data to
the Extension's author or to any third party. It does not use analytics,
advertising, telemetry, or remote logging. Everything happens locally in your
browser.

## What the Extension does

The Extension makes authenticated requests to your own [Claude](https://claude.ai)
account in order to read your subscription usage and display it in the
toolbar. It uses the cookies that your browser already has for `claude.ai` —
the same cookies you set when you signed in to Claude yourself. No tokens,
passwords, or credentials are ever entered into or stored by the Extension.

The Extension calls only the following claude.ai endpoints, and only on
your own machine:

- `GET https://claude.ai/api/organizations` — to discover which organization
  your account is currently active on.
- `GET https://claude.ai/api/organizations/{id}/usage` — to read your current
  5-hour and weekly usage percentages and reset times.
- `GET https://claude.ai/api/organizations/{id}/prepaid/credits` — to read
  your prepaid credits balance (if any).
- `GET https://claude.ai/v1/code/routines/run-budget` — to read the daily
  routine-runs budget for Claude Code triggers (if any).

The responses are read in your browser, used to update the toolbar badge and
populate the popup, and stored locally as described below.

## What is stored locally

The Extension uses `chrome.storage.local` to keep three values on your
machine. None of this data ever leaves your browser:

| Key | Purpose |
| --- | --- |
| `claudeUsageData` | The most recent usage / credits / routines bundle, plus the timestamp it was fetched at and any error message. |
| `claudeUsageOrgId` | The currently-active organization ID, so the next request can skip the `organizations` lookup. Cleared automatically on a 401/403 from `claude.ai`. |
| `claudeUsageLastFetch` | A timestamp used to throttle requests to Claude (no more than one fetch every 30 seconds, even on manual refresh). |

The Extension does not write to `localStorage`, IndexedDB, cookies, or any
disk-backed storage outside of `chrome.storage.local`.

## What is not done

- No data is sent to the Extension's author.
- No analytics or telemetry of any kind.
- No advertising or third-party scripts.
- No content scripts are injected into the pages you browse — the Extension
  has no access to anything outside its own popup and the four `claude.ai`
  endpoints listed above.

## Permissions

- `host_permissions` for `https://claude.ai/*` — required so the background
  service worker can call the four endpoints above with your existing
  cookies.
- `storage` — required to keep the three local values described above.
- `alarms` — required to schedule the periodic refresh (every 10 minutes)
  without keeping the service worker alive in the background.

## Affiliation

This Extension is **not** affiliated with, endorsed by, or sponsored by
Anthropic. "Claude" is a trademark of Anthropic; the Extension uses the name
descriptively to indicate what service it works with.

## Changes

This policy may be updated to reflect changes in the Extension. Material
changes will be reflected in the "Last updated" date at the top of this file.
The current version is always available in the source repository:
<https://github.com/Nachtalb/claude-usage-meter/blob/main/PRIVACY.md>

## Contact

Questions or concerns about privacy:
<https://github.com/Nachtalb/claude-usage-meter/issues>
