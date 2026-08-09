"""Tracks pay-as-you-go Anthropic API credit spend via the Admin Cost API.

This is a separate axis from the 5-hour/weekly meters above it in the
overlay: those scrape a claude.ai Pro/Max subscription's rate-limit windows
through the browser extension, this calls Anthropic's official Usage & Cost
Admin API (an organization-management endpoint billed like any other admin
call — it does not consume Messages-API tokens/credits) to read $ spent.

There is currently no public Anthropic API for the remaining prepaid credit
balance itself, so `total_purchased_usd` in the config is a manual snapshot
the user takes from console.anthropic.com/settings/billing on a given date
(`since`); this module sums spend from that date forward and subtracts.
"""
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

CONFIG_FILE = Path.home() / "token-meter" / "api_credits_config.json"
OUTPUT_FILE = Path.home() / "token-meter" / "api_credits.json"
POLL_INTERVAL_S = 120
API_URL = "https://api.anthropic.com/v1/organizations/cost_report"


def _load_config():
    try:
        cfg = json.loads(CONFIG_FILE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    if not cfg.get("admin_api_key") or cfg.get("total_purchased_usd") is None:
        return None
    return cfg


def _fetch_spent_cents(api_key, since_iso, ending_iso):
    total_cents = 0.0
    page = None
    while True:
        params = {
            "starting_at": since_iso,
            "ending_at": ending_iso,
            "bucket_width": "1d",
            "limit": "31",
        }
        if page:
            params["page"] = page
        url = f"{API_URL}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(
            url,
            headers={"anthropic-version": "2023-06-01", "x-api-key": api_key},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read())

        for bucket in body.get("data", []):
            for result in bucket.get("results", []):
                total_cents += float(result.get("amount", 0))

        if not body.get("has_more"):
            break
        page = body.get("next_page")
        if not page:
            break

    return total_cents


def _read_existing():
    try:
        return json.loads(OUTPUT_FILE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _write(payload):
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(payload))


def poll_once():
    cfg = _load_config()
    if cfg is None:
        _write({"configured": False})
        return

    since = cfg.get("since") or (
        datetime.now(timezone.utc) - timedelta(days=30)
    ).strftime("%Y-%m-%d")
    since_iso = f"{since}T00:00:00Z"
    # The cost report only covers fully-completed UTC days — today's bucket
    # isn't queryable yet, so cap the range at the start of today.
    today_start_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")

    try:
        if since_iso >= today_start_iso:
            spent = 0.0
        else:
            spent = _fetch_spent_cents(cfg["admin_api_key"], since_iso, today_start_iso) / 100
        _write(
            {
                "configured": True,
                "since": since,
                "total": cfg["total_purchased_usd"],
                "spent": spent,
                "remaining": cfg["total_purchased_usd"] - spent,
                "error": None,
                "updated": time.time() * 1000,
            }
        )
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as e:
        payload = _read_existing()
        payload["configured"] = True
        payload["error"] = str(e)
        payload["updated"] = time.time() * 1000
        _write(payload)


def run_forever(interval_s=POLL_INTERVAL_S):
    while True:
        try:
            poll_once()
        except Exception:
            pass
        time.sleep(interval_s)


if __name__ == "__main__":
    run_forever()
