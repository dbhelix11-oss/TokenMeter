// Background service worker for Claude Usage Meter.
//
// Fetches usage data from claude.ai and updates the toolbar badge with the
// current 5-hour session utilization.
//
// Rate-limiting invariants (this worker MUST never hammer claude.ai):
//   1. Fetches are driven by a single alarm that fires every REFRESH_MINUTES.
//   2. Manual refreshes (from the popup) and the initial install/startup
//      refresh go through the same gate and are subject to MIN_FETCH_INTERVAL_MS.
//   3. If a fetch is already in flight, callers share that promise instead of
//      starting a second one.
//   4. There is intentionally NO cookies.onChanged listener — claude.ai
//      rotates the sessionKey on every response, and listening to that
//      produces an infinite fetch → rotate → fetch loop.

const NATIVE_HOST_NAME = 'com.tokenmeter.claude_usage';
const ALARM_NAME = 'claude-usage-refresh';
const REFRESH_MINUTES = 1;                    // how often the alarm fires
const MIN_FETCH_INTERVAL_MS = 30 * 1000;      // hard throttle across ALL refresh paths
const STORAGE_KEY = 'claudeUsageData';
const ORG_STORAGE_KEY = 'claudeUsageOrgId';
const LAST_FETCH_KEY = 'claudeUsageLastFetch';

// Headers required by /v1/code/routines/run-budget as of 2026-01-30.
const ROUTINES_BETA = 'ccr-triggers-2026-01-30';
const ANTHROPIC_VERSION = '2023-06-01';

class AuthError extends Error {
  constructor(msg) { super(msg); this.name = 'AuthError'; }
}

async function getActiveOrganizationId() {
  const cached = await chrome.storage.local.get(ORG_STORAGE_KEY);
  if (cached[ORG_STORAGE_KEY]) return cached[ORG_STORAGE_KEY];

  const res = await fetch('https://claude.ai/api/organizations', {
    credentials: 'include',
    headers: { 'Accept': 'application/json' }
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new AuthError(`organizations -> ${res.status}`);
    }
    throw new Error(`organizations -> ${res.status}`);
  }
  const orgs = await res.json();
  if (!Array.isArray(orgs) || orgs.length === 0) throw new Error('no organizations');
  const pick =
    orgs.find(o => Array.isArray(o.capabilities) && o.capabilities.includes('chat')) ||
    orgs[0];
  const orgId = pick.uuid || pick.id;
  if (!orgId) throw new Error('organization has no uuid');
  await chrome.storage.local.set({ [ORG_STORAGE_KEY]: orgId });
  return orgId;
}

async function fetchJson(url, { headers = {}, authScoped = true } = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Accept': 'application/json', ...headers }
  });
  if (!res.ok) {
    if (authScoped && (res.status === 401 || res.status === 403)) {
      await chrome.storage.local.remove(ORG_STORAGE_KEY);
      throw new AuthError(`${url} -> ${res.status}`);
    }
    throw new Error(`${url} -> ${res.status}`);
  }
  return res.json();
}

async function fetchUsage() {
  const orgId = await getActiveOrganizationId();

  const usage = await fetchJson(
    `https://claude.ai/api/organizations/${orgId}/usage`
  );

  // Prepaid credits (current balance). Non-fatal outside of auth errors.
  let credits = null;
  try {
    credits = await fetchJson(
      `https://claude.ai/api/organizations/${orgId}/prepaid/credits`
    );
  } catch (err) {
    if (err && err.name === 'AuthError') throw err;
    console.warn('[Claude Usage] prepaid/credits fetch failed:', err);
  }

  // Daily routine runs. Requires the anthropic-beta header.
  let routines = null;
  try {
    routines = await fetchJson(
      'https://claude.ai/v1/code/routines/run-budget',
      { headers: {
          'anthropic-beta': ROUTINES_BETA,
          'anthropic-version': ANTHROPIC_VERSION
        } }
    );
  } catch (err) {
    if (err && err.name === 'AuthError') throw err;
    console.warn('[Claude Usage] routines/run-budget fetch failed:', err);
  }

  return { usage, credits, routines };
}

function pickBadgeColor(pct) {
  if (pct >= 90) return '#C8533C';
  if (pct >= 70) return '#D98639';
  return '#3A6FD9';
}

async function applyResultToBadge(bundle, errorKind = null) {
  if (errorKind === 'auth') {
    await chrome.action.setBadgeText({ text: '?' });
    await chrome.action.setBadgeBackgroundColor({ color: '#999999' });
    await chrome.action.setTitle({ title: 'Claude usage — sign in to claude.ai' });
    return;
  }
  if (errorKind === 'generic') {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#999999' });
    await chrome.action.setTitle({ title: 'Claude usage — fetch failed' });
    return;
  }
  const pct = Math.round((bundle?.usage?.five_hour?.utilization ?? 0));
  await chrome.action.setBadgeText({
    text: Number.isFinite(pct) ? String(pct) : ''
  });
  await chrome.action.setBadgeBackgroundColor({ color: pickBadgeColor(pct) });
  if (chrome.action.setBadgeTextColor) {
    try { await chrome.action.setBadgeTextColor({ color: '#FFFFFF' }); } catch (_) {}
  }
  await chrome.action.setTitle({
    title: `Claude usage — 5h: ${pct}% used`
  });
}

// Best-effort push of the freshly fetched bundle to the local desktop widget
// via Native Messaging. Failures here (host not installed, etc.) must never
// break the extension's own badge/popup behavior.
function pushToNativeHost(bundle, fetchedAt) {
  try {
    chrome.runtime.sendNativeMessage(
      NATIVE_HOST_NAME,
      { data: bundle, fetchedAt },
      () => {
        if (chrome.runtime.lastError) {
          console.warn('[Claude Usage] native host push failed:', chrome.runtime.lastError.message);
        }
      }
    );
  } catch (err) {
    console.warn('[Claude Usage] native host push threw:', err);
  }
}

// Single in-flight promise, so overlapping calls share one network round-trip.
let inFlight = null;

async function doRefresh() {
  try {
    const bundle = await fetchUsage();
    const fetchedAt = Date.now();
    await chrome.storage.local.set({
      [STORAGE_KEY]: { data: bundle, fetchedAt, error: null, errorKind: null },
      [LAST_FETCH_KEY]: fetchedAt
    });
    await applyResultToBadge(bundle);
    pushToNativeHost(bundle, fetchedAt);
    return { ok: true };
  } catch (err) {
    const isAuth = err && err.name === 'AuthError';
    console.warn('[Claude Usage] refresh failed:', err);
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        data: null, fetchedAt: Date.now(),
        error: String(err && err.message || err),
        errorKind: isAuth ? 'auth' : 'generic'
      },
      [LAST_FETCH_KEY]: Date.now()
    });
    await applyResultToBadge(null, isAuth ? 'auth' : 'generic');
    return { ok: false };
  }
}

/**
 * Refresh, but no more often than MIN_FETCH_INTERVAL_MS. If `force` is true
 * the minimum interval is still enforced (otherwise the UI could spam it).
 * Returns the cached "stored" record after the operation.
 */
async function refreshAndUpdateBadge({ force = false } = {}) {
  if (inFlight) return inFlight;

  const { [LAST_FETCH_KEY]: last = 0 } = await chrome.storage.local.get(LAST_FETCH_KEY);
  const sinceMs = Date.now() - last;
  if (!force && sinceMs < MIN_FETCH_INTERVAL_MS) {
    // Skip this call — we fetched recently. No network traffic.
    return { ok: true, skipped: true, sinceMs };
  }

  inFlight = doRefresh().finally(() => { inFlight = null; });
  return inFlight;
}

function ensureAlarm() {
  // chrome.alarms.create replaces any existing alarm of the same name, so
  // this always reflects the current REFRESH_MINUTES even after a reload
  // that changed it (an old alarm would otherwise persist unchanged).
  chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: REFRESH_MINUTES,
    delayInMinutes: 0
  });
}

// Run unconditionally at script load, not just inside onInstalled/onStartup —
// a manual "Reload" in chrome://extensions doesn't reliably fire either of
// those, which left a stale alarm period in place after edits here.
ensureAlarm();

chrome.runtime.onInstalled.addListener(() => {
  refreshAndUpdateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  refreshAndUpdateBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) refreshAndUpdateBadge();
});

// Popup messaging — routes through the same throttled path.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'refresh-usage') {
    refreshAndUpdateBadge({ force: !!msg.force })
      .then(async (res) => {
        const stored = await chrome.storage.local.get(STORAGE_KEY);
        sendResponse({ ok: true, skipped: !!res.skipped, stored: stored[STORAGE_KEY] || null });
      })
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});
