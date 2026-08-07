// Popup UI for Claude Usage Meter.
// Reads cached data from chrome.storage.local and lets the user force a refresh.

const STORAGE_KEY = 'claudeUsageData';
const SETTINGS_URL = 'https://claude.ai/settings/usage/';
// On popup open, only kick off a background refresh if the cache is older
// than this. Manual refresh button is unaffected.
const STALE_AFTER_MS = 60 * 1000;

const $ = (id) => document.getElementById(id);

function fmtPct(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${Math.round(value)}% used`;
}

function setBarFill(el, utilization) {
  if (!el) return;
  const u = Number(utilization) || 0;
  // The bar visually caps at 100%, but numbers (like 105%) are shown in text.
  const width = Math.max(0, Math.min(100, u));
  el.style.width = `${width}%`;
  el.classList.remove('warn', 'danger');
  if (u >= 100) el.classList.add('danger');
  else if (u >= 70) el.classList.add('warn');
}

function formatResetRelative(iso, prefix = 'Resets') {
  if (!iso) return '';
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return '';
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();

  if (diffMs <= 0) return `${prefix} now`;

  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffHr < 24) {
    const hrs = Math.floor(diffMin / 60);
    const mins = diffMin % 60;
    if (hrs === 0) return `${prefix} in ${mins} min`;
    return `${prefix} in ${hrs} hr ${mins} min`;
  }

  // For week-scale resets show a weekday + time (e.g. "Resets Thu 10:00 PM").
  if (diffDays < 7) {
    const weekday = target.toLocaleDateString(undefined, { weekday: 'short' });
    const time = target.toLocaleTimeString(undefined, {
      hour: 'numeric', minute: '2-digit'
    });
    return `${prefix} ${weekday} ${time}`;
  }

  // Fall back to a date.
  return `${prefix} ${target.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function formatLastUpdated(ts) {
  if (!ts) return 'Last updated: —';
  const diffSec = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `Last updated: just now`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Last updated: ${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `Last updated: ${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  return `Last updated: ${new Date(ts).toLocaleString()}`;
}

function formatCurrency(amount, currency) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2
    }).format(n);
  } catch (_) {
    return `$${n.toFixed(2)}`;
  }
}

function render(stored) {
  const errorBanner = $('errorBanner');
  const signinCard = $('signinCard');

  const isAuth = stored && stored.errorKind === 'auth';
  const hasData = !!(stored && stored.data);

  if (!hasData && isAuth) {
    document.body.classList.add('signed-out');
    signinCard.hidden = false;
    errorBanner.hidden = true;
    return;
  }

  document.body.classList.remove('signed-out');
  signinCard.hidden = true;

  if (!hasData && stored && stored.error) {
    errorBanner.hidden = false;
    errorBanner.innerHTML = `Couldn't load usage. Open
      <a href="${SETTINGS_URL}" target="_blank" rel="noopener noreferrer">claude.ai/settings/usage</a>
      and try again.`;
  } else {
    errorBanner.hidden = true;
  }

  const bundle = stored && stored.data;
  if (!bundle) return;
  const data = bundle.usage || bundle; // back-compat if old shape is cached

  // --- Current session (5-hour)
  const fh = data.five_hour || {};
  setBarFill($('fiveHourFill'), fh.utilization);
  $('fiveHourPct').textContent = fmtPct(fh.utilization);
  $('fiveHourReset').textContent = fh.resets_at
    ? formatResetRelative(fh.resets_at, 'Resets in').replace(/^Resets in in /, 'Resets in ')
    : '—';
  // The Claude UI phrasing is "Resets in 4 hr 8 min" for short windows —
  // our formatter already produces "Resets in X hr Y min" when diff < 24h.
  if (fh.resets_at) {
    const target = new Date(fh.resets_at);
    const diffMs = target.getTime() - Date.now();
    if (diffMs > 0 && diffMs < 24 * 3600 * 1000) {
      const totalMin = Math.floor(diffMs / 60000);
      const hrs = Math.floor(totalMin / 60);
      const mins = totalMin % 60;
      $('fiveHourReset').textContent =
        hrs > 0 ? `Resets in ${hrs} hr ${mins} min` : `Resets in ${mins} min`;
    } else {
      $('fiveHourReset').textContent = formatResetRelative(fh.resets_at, 'Resets');
    }
  }

  // --- Weekly (all models)
  const wk = data.seven_day || {};
  setBarFill($('weeklyFill'), wk.utilization);
  $('weeklyPct').textContent = fmtPct(wk.utilization);
  $('weeklyReset').textContent = wk.resets_at ? formatResetRelative(wk.resets_at) : '—';

  // Optional weekly sub-meters (opus / sonnet / cowork / etc) if the API returns them.
  const weeklyExtra = $('weeklyExtra');
  weeklyExtra.innerHTML = '';
  const subMeters = [
    { key: 'seven_day_opus', label: 'Opus' },
    { key: 'seven_day_sonnet', label: 'Sonnet' },
    { key: 'seven_day_cowork', label: 'Cowork' },
    { key: 'seven_day_oauth_apps', label: 'API apps' }
  ];
  for (const m of subMeters) {
    const v = data[m.key];
    if (!v || typeof v.utilization !== 'number') continue;
    const row = document.createElement('div');
    row.className = 'meter-row';
    row.innerHTML = `
      <div class="meter-label">
        <p class="label-primary">${m.label}</p>
        <p class="label-secondary">${v.resets_at ? formatResetRelative(v.resets_at) : ''}</p>
      </div>
      <div class="meter-track">
        <div class="bar"><div class="bar-fill" style="width:${Math.min(100, v.utilization)}%"></div></div>
        <p class="pct">${fmtPct(v.utilization)}</p>
      </div>`;
    weeklyExtra.appendChild(row);
  }

  // --- Daily routine runs (strictly from /v1/code/routines/run-budget)
  const routinesSection = $('routinesSection');
  const runBudget = bundle.routines; // { limit: "5", used: "0", unified_billing_enabled: true }

  let routinesShown = false;
  if (runBudget && runBudget.limit !== undefined && runBudget.used !== undefined) {
    const limit = Number(runBudget.limit);
    const used = Number(runBudget.used);
    if (Number.isFinite(limit) && Number.isFinite(used) && limit > 0) {
      routinesSection.hidden = false;
      routinesShown = true;
      const pct = Math.floor((used / limit) * 100);
      setBarFill($('routinesFill'), pct);
      $('routinesPct').textContent = `${used} / ${limit}`;
      $('routinesSub').textContent = used === 0
        ? "You haven't run any routines yet"
        : `${used} of ${limit} used`;
    }
  }
  // Intentionally no percentage fallback — the routines meter is only meaningful as a count.
  if (!routinesShown) {
    routinesSection.hidden = true;
  }

  // --- Extra usage
  const extra = data.extra_usage;
  const extraSection = $('extraSection');
  const extraMeterTrack = $('extraMeterTrack');
  const extraLimitEl = $('extraLimit');
  const extraPctEl = $('extraPct');

  if (extra && (extra.is_enabled || typeof extra.used_credits === 'number' || extra.monthly_limit != null)) {
    extraSection.hidden = false;
    const currency = extra.currency || 'USD';

    // API returns values in cents (e.g. 2003 -> $20.03, 1900 -> $19).
    const centsToDollars = (n) => (typeof n === 'number' ? n / 100 : n);
    const usedDollars = centsToDollars(extra.used_credits);
    const limitDollars = extra.monthly_limit == null ? null : centsToDollars(extra.monthly_limit);

    $('extraSpent').textContent = `${formatCurrency(usedDollars, currency)} spent`;

    const isUnlimited = extra.monthly_limit == null && extra.is_enabled;

    if (isUnlimited) {
      // No bar, no percentage — show "Unlimited" where the monthly limit would be.
      if (extraMeterTrack) extraMeterTrack.hidden = true;
      extraLimitEl.textContent = 'Unlimited';
      extraLimitEl.classList.add('limit-unlimited');
    } else {
      if (extraMeterTrack) extraMeterTrack.hidden = false;
      extraLimitEl.classList.remove('limit-unlimited');
      extraLimitEl.textContent = formatCurrency(limitDollars, currency);

      // Recompute percentage from raw cents (floor). Don't trust server utilization
      // because it caps at 100 while the display shows > 100% when over cap.
      let pct = null;
      if (typeof extra.used_credits === 'number' && typeof extra.monthly_limit === 'number'
          && extra.monthly_limit > 0) {
        pct = Math.floor((extra.used_credits / extra.monthly_limit) * 100);
      } else if (typeof extra.utilization === 'number') {
        pct = Math.floor(extra.utilization);
      }
      extraPctEl.textContent = pct == null ? '—' : `${pct}% used`;
      setBarFill($('extraFill'), pct);
    }

    $('extraEnabledLabel').textContent = extra.is_enabled
      ? 'Extra usage is enabled — keep using Claude past plan limits.'
      : 'Extra usage is off. Turn it on to keep using Claude past plan limits.';
  } else {
    extraSection.hidden = true;
  }

  // --- Current balance from /prepaid/credits (amount is in cents)
  const credits = bundle.credits;
  if (credits && typeof credits.amount === 'number') {
    const balDollars = credits.amount / 100;
    $('extraBalance').textContent = formatCurrency(balDollars, credits.currency || 'USD');
  } else if (extra && !extra.is_enabled) {
    $('extraBalance').textContent = formatCurrency(0, 'USD');
  } else {
    $('extraBalance').textContent = '—';
  }

  // --- Last updated
  $('lastUpdated').textContent = formatLastUpdated(stored.fetchedAt);
}

async function loadFromStorage() {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  return res[STORAGE_KEY] || null;
}

async function triggerRefresh() {
  const btn = $('refreshBtn');
  btn.classList.add('spinning');
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'refresh-usage' });
    if (resp && resp.stored) {
      render(resp.stored);
    } else {
      render(await loadFromStorage());
    }
  } catch (e) {
    console.warn('refresh message failed', e);
    render(await loadFromStorage());
  } finally {
    btn.classList.remove('spinning');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Wire up "Adjust limit" / "Buy extra usage" etc.
  document.querySelectorAll('[data-open="usage"]').forEach(el => {
    el.addEventListener('click', () => {
      chrome.tabs.create({ url: SETTINGS_URL });
    });
  });

  // Sign-in CTA shown when we detect an auth error.
  const signinBtn = $('signinBtn');
  if (signinBtn) {
    signinBtn.addEventListener('click', () => {
      // Claude's app will redirect to /login?returnTo=/settings/usage/ when unauthenticated.
      chrome.tabs.create({ url: SETTINGS_URL });
    });
  }

  $('refreshBtn').addEventListener('click', triggerRefresh);

  // Initial render from cache. Only trigger a refresh if the cache is stale
  // (or missing entirely) — we don't want every popup open to hit the API.
  const cached = await loadFromStorage();
  if (cached) render(cached);

  const cacheAge = cached && cached.fetchedAt
    ? Date.now() - cached.fetchedAt
    : Infinity;
  if (!cached || cacheAge > STALE_AFTER_MS) {
    triggerRefresh();
  }
});
