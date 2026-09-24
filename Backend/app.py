"""
Rates Dashboard backend.

Data sources:
  * FRED (via direct JSON HTTP API, parallel) for yields + macro series.
  * CME FedWatch (scraped) for FOMC target-rate probabilities.

No yfinance, no pandas_datareader — both were slow and flaky.
"""

import os
import time
import json
import math
import threading
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv

from cache_manager import (
    is_cache_valid, load_from_cache, save_to_cache,
    get_cache_age,
)

load_dotenv()

# --- static folder resolution (unchanged) ---
static_folder_path = None
for path in ('dist', '../Frontend/frontend/dist', '../../Frontend/frontend/dist', 'Frontend/frontend/dist'):
    full = os.path.join(os.path.dirname(__file__), path) if not os.path.isabs(path) else path
    if os.path.isdir(full):
        static_folder_path = full
        break
if static_folder_path is None:
    static_folder_path = os.path.join(os.path.dirname(__file__), 'static')
    os.makedirs(static_folder_path, exist_ok=True)

app = Flask(__name__, static_folder=static_folder_path, static_url_path='/')
CORS(app)

FRED_API_KEY = os.getenv("FRED_API_KEY", "YOUR_API_KEY_HERE")
FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"
HTTP_TIMEOUT = 8

# --- in-memory cache ---
CACHE_DURATION = timedelta(minutes=5)
memory_cache = {k: {'data': None, 'timestamp': None} for k in ('macro', 'rates', 'fedwatch')}
cache_lock = threading.Lock()

def get_cached_data(key):
    with cache_lock:
        c = memory_cache.get(key)
        if c and c['data'] is not None and c['timestamp']:
            if datetime.now() - c['timestamp'] < CACHE_DURATION:
                return c['data']
    return None

def set_cached_data(key, data):
    with cache_lock:
        memory_cache[key] = {'data': data, 'timestamp': datetime.now()}

def compare_data(a, b):
    """Deep equality with float tolerance so tiny FP drift doesn't churn cache."""
    if a is b:
        return False
    if type(a) != type(b):
        return True
    if isinstance(a, dict):
        if a.keys() != b.keys():
            return True
        return any(compare_data(a[k], b[k]) for k in a)
    if isinstance(a, list):
        if len(a) != len(b):
            return True
        return any(compare_data(x, y) for x, y in zip(a, b))
    if isinstance(a, float) or isinstance(b, float):
        try:
            return abs(float(a) - float(b)) > 1e-6
        except (TypeError, ValueError):
            return a != b
    return a != b


# ============================================================
# FRED direct HTTP client
# ============================================================
def fred_observations(series_id, start=None, end=None, session=None):
    """Hit FRED JSON endpoint directly. Fast, no pandas_datareader."""
    if FRED_API_KEY == "YOUR_API_KEY_HERE":
        return []
    params = {
        "series_id": series_id,
        "api_key": FRED_API_KEY,
        "file_type": "json",
    }
    if start:
        params["observation_start"] = start.strftime("%Y-%m-%d") if hasattr(start, "strftime") else start
    if end:
        params["observation_end"] = end.strftime("%Y-%m-%d") if hasattr(end, "strftime") else end
    s = session or requests
    r = s.get(FRED_BASE, params=params, timeout=HTTP_TIMEOUT)
    r.raise_for_status()
    obs = r.json().get("observations", [])
    # Drop FRED sentinel '.'
    cleaned = []
    for o in obs:
        v = o.get("value")
        if v is None or v == "." or v == "":
            continue
        try:
            cleaned.append({"date": o["date"], "value": float(v)})
        except ValueError:
            continue
    return cleaned


# ============================================================
# Yield curve — parallel FRED fetch, no yfinance
# ============================================================
FRED_YIELD_SERIES = {
    '1M':  'DGS1MO',
    '3M':  'DGS3MO',
    '6M':  'DGS6MO',
    '1Y':  'DGS1',
    '2Y':  'DGS2',
    '3Y':  'DGS3',
    '5Y':  'DGS5',
    '7Y':  'DGS7',
    '10Y': 'DGS10',
    '20Y': 'DGS20',
    '30Y': 'DGS30',
}

def maturity_to_years(m):
    if m.endswith('W'): return int(m[:-1]) / 52.0
    if m.endswith('M'): return int(m[:-1]) / 12.0
    if m.endswith('Y'): return float(m[:-1])
    return 0.0

def calculate_dv01(face_value, duration, _yield_percent):
    return duration * 0.0001 * face_value

def get_yield_curve():
    end = datetime.now().date()
    start = end - timedelta(days=30)
    session = requests.Session()
    out = {}

    def one(label, series_id):
        try:
            obs = fred_observations(series_id, start, end, session=session)
            if obs:
                return label, obs[-1]["value"]
        except Exception as e:
            print(f"[yield] {label} ({series_id}) failed: {e}")
        return label, None

    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = [ex.submit(one, l, s) for l, s in FRED_YIELD_SERIES.items()]
        for f in as_completed(futures):
            label, val = f.result()
            if val is not None:
                out[label] = val
    return out


# ============================================================
# Macro — parallel FRED fetch
# ============================================================
MACRO_SERIES = {
    "CPI":                 "CPIAUCSL",
    "PCE Headline":        "PCEPI",
    "PCE Core":            "PCECTPI",
    "PPI":                 "PPIACO",
    "PMI":                 "NAPM",
    "Non-Farm Payrolls":   "PAYEMS",
    "Unemployment Rate":   "UNRATE",
    "Unemployment Claims": "ICSA",
    "JOLTS":               "JTSJOL",
    "Consumer Sentiment":  "UMCSENT",
    "Consumer Confidence": "CONCCONF",
}
PMI_FALLBACKS = ["MANPMI"]
YOY_SERIES     = {"CPI", "PCE Headline", "PCE Core", "PPI", "Non-Farm Payrolls", "JOLTS"}
QOQ_SERIES     = {"CPI", "PCE Headline", "PCE Core", "PPI"}

def _closest_on_or_before(obs, target_date_str):
    """obs is sorted ascending by date. Return value on or before target (str YYYY-MM-DD)."""
    prev = None
    for o in obs:
        if o["date"] <= target_date_str:
            prev = o
        else:
            break
    return prev

def _build_series_payload(name, obs):
    if not obs:
        return None
    # sort + dedup
    obs = sorted(obs, key=lambda o: o["date"])
    seen = {}
    for o in obs:
        seen[o["date"]] = o["value"]
    obs = [{"date": d, "value": v} for d, v in seen.items()]
    obs.sort(key=lambda o: o["date"])

    # pct_change point-over-point
    hist = []
    prev_v = None
    for o in obs:
        pct = 0.0 if prev_v in (None, 0) else (o["value"] - prev_v) / prev_v * 100
        hist.append({"date": o["date"], "value": o["value"], "pct_change": round(pct, 2)})
        prev_v = o["value"]

    latest = obs[-1]["value"]
    latest_date = obs[-1]["date"]
    prev = obs[-2]["value"] if len(obs) > 1 else latest
    change = 0.0 if prev == 0 else (latest - prev) / prev * 100

    payload = {
        "history": hist,
        "current": latest,
        "latest_date": latest_date,
        "change": round(change, 2),
    }

    latest_dt = datetime.strptime(latest_date, "%Y-%m-%d")

    if name in YOY_SERIES:
        target = (latest_dt - timedelta(days=365)).strftime("%Y-%m-%d")
        yr = _closest_on_or_before(obs, target)
        if yr and yr["value"] != 0:
            payload["yoy_change"] = round((latest - yr["value"]) / yr["value"] * 100, 2)

    if name in QOQ_SERIES:
        qhist = []
        for o in obs:
            target = (datetime.strptime(o["date"], "%Y-%m-%d") - timedelta(days=90)).strftime("%Y-%m-%d")
            past = _closest_on_or_before(obs, target)
            if past and past["value"] != 0:
                q = (o["value"] - past["value"]) / past["value"] * 100
            else:
                q = 0.0
            qhist.append({"date": o["date"], "quarterly_change": round(q, 2)})
        payload["quarterly_change_history"] = qhist

    return payload

def fetch_macro_data():
    if FRED_API_KEY == "YOUR_API_KEY_HERE":
        return {"error": "Missing FRED API Key"}

    session = requests.Session()
    start = datetime.now() - timedelta(days=550)
    end = datetime.now() + timedelta(days=60)
    out = {}

    def fetch_one(name, sid):
        candidates = [sid] + (PMI_FALLBACKS if name == "PMI" else [])
        for cand in candidates:
            try:
                obs = fred_observations(cand, start, end, session=session)
                if obs:
                    return name, _build_series_payload(name, obs)
            except Exception as e:
                print(f"[macro] {name} ({cand}) failed: {e}")
                continue
        return name, None

    with ThreadPoolExecutor(max_workers=10) as ex:
        futures = [ex.submit(fetch_one, n, s) for n, s in MACRO_SERIES.items()]
        for f in as_completed(futures):
            name, payload = f.result()
            if payload:
                out[name] = payload
    return out


# ============================================================
# Rates analysis
# ============================================================
def fetch_rates_data():
    yields = get_yield_curve()
    if not yields:
        return {"error": "Failed to fetch yields"}

    short = yields.get('2Y') or yields.get('1Y') or yields.get('3M', 0)
    spread_2s10s = yields.get('10Y', 0) - short
    spread_5s30s = yields.get('30Y', 0) - yields.get('5Y', 0)

    if spread_2s10s < 0:
        curve_shape, trade_pitch = "Inverted", "Bull Steepener (Expecting cuts)"
    elif spread_2s10s < 0.5:
        curve_shape, trade_pitch = "Flat", "Range-bound; watch macro prints"
    else:
        curve_shape, trade_pitch = "Normal", "Bear Flattener (Rates rising)"

    dv01 = calculate_dv01(10_000_000, 8.0, yields.get('10Y', 4.0))

    sorted_yields = dict(sorted(yields.items(), key=lambda x: maturity_to_years(x[0])))
    yield_curve_data = [
        {"maturity": k, "years": maturity_to_years(k), "yield": v}
        for k, v in sorted_yields.items()
    ]

    return {
        "yields": sorted_yields,
        "yield_curve": yield_curve_data,
        "analysis": {
            "spread_2s10s": round(spread_2s10s, 2),
            "spread_5s30s": round(spread_5s30s, 2),
            "curve_shape": curve_shape,
            "trade_pitch": trade_pitch,
            "dv01_10m_position": f"${dv01:,.2f}",
        }
    }


# ============================================================
# FedWatch — CME scrape with graceful fallback
# ============================================================
CME_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/121.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html",
    "Origin": "https://www.cmegroup.com",
}

CME_UPCOMING = "https://www.cmegroup.com/CmeWS/mvc/FedwatchTool/UpcomingMeetings"
CME_MEETING_TMPL = "https://www.cmegroup.com/CmeWS/mvc/FedwatchTool/Probabilities?meetingDate={date}"

def _current_fed_target_from_fred():
    try:
        upper = fred_observations("DFEDTARU", datetime.now() - timedelta(days=30), datetime.now())
        lower = fred_observations("DFEDTARL", datetime.now() - timedelta(days=30), datetime.now())
        if upper and lower:
            u_bps = int(round(upper[-1]["value"] * 100))
            l_bps = int(round(lower[-1]["value"] * 100))
            return l_bps, u_bps
    except Exception as e:
        print(f"[fed target] failed: {e}")
    return None

def _current_effr_from_fred():
    try:
        obs = fred_observations("DFF", datetime.now() - timedelta(days=15), datetime.now())
        if obs:
            return obs[-1]["value"]
    except Exception:
        pass
    return None

def _scrape_cme_fedwatch():
    """Best-effort scrape of CME FedWatch. Returns dict or None."""
    try:
        r = requests.get(CME_UPCOMING, headers=CME_HEADERS, timeout=HTTP_TIMEOUT)
        r.raise_for_status()
        meetings = r.json()
        if not isinstance(meetings, list) or not meetings:
            return None

        # Pick next meeting whose date is >= today
        today = datetime.now().strftime("%Y-%m-%d")
        upcoming = [m for m in meetings if str(m.get("meetingDate", ""))[:10] >= today]
        if not upcoming:
            upcoming = meetings
        m = upcoming[0]
        meeting_date_raw = str(m.get("meetingDate", ""))[:10]

        r2 = requests.get(CME_MEETING_TMPL.format(date=meeting_date_raw),
                          headers=CME_HEADERS, timeout=HTTP_TIMEOUT)
        r2.raise_for_status()
        probs_payload = r2.json()

        # CME response structures vary; look for the probability list
        buckets = None
        if isinstance(probs_payload, dict):
            for key in ("probabilities", "meetings", "data"):
                v = probs_payload.get(key)
                if isinstance(v, list) and v:
                    buckets = v
                    break

        if not buckets:
            return None

        # Normalize buckets → {range_bps: pct}
        target_probs = {}
        for b in buckets:
            # Try a few common shapes
            lo = b.get("targetRateLow") or b.get("lowerBound") or b.get("low")
            hi = b.get("targetRateHigh") or b.get("upperBound") or b.get("high")
            rng = b.get("targetRate") or b.get("range")
            prob = b.get("probability") or b.get("prob") or b.get("value")
            if prob is None:
                continue
            if rng and "-" in str(rng):
                key = str(rng).replace(" ", "")
            elif lo is not None and hi is not None:
                key = f"{int(round(float(lo)))}-{int(round(float(hi)))}"
            else:
                continue
            try:
                p = float(prob)
                if p <= 1.0:
                    p *= 100
                target_probs[key] = round(p, 2)
            except (TypeError, ValueError):
                continue

        if not target_probs:
            return None

        target_probs = dict(sorted(target_probs.items(), key=lambda x: int(x[0].split('-')[0])))
        most_likely = max(target_probs.items(), key=lambda x: x[1])

        # Nice date
        try:
            nice_date = datetime.strptime(meeting_date_raw, "%Y-%m-%d").strftime("%d %b %Y")
        except ValueError:
            nice_date = meeting_date_raw

        cur_target = None
        cur_range = _current_fed_target_from_fred()
        if cur_range:
            cur_target = f"{cur_range[0]}-{cur_range[1]}"
        effr = _current_effr_from_fred()

        return {
            "next_meeting_date": nice_date,
            "target_rate_probabilities": target_probs,
            "most_likely_change": most_likely[0],
            "most_likely_probability": round(most_likely[1], 1),
            "current_target_rate": cur_target,
            "current_fed_rate": round(effr, 2) if effr is not None else None,
            "source": "CME FedWatch (live)",
        }
    except Exception as e:
        print(f"[fedwatch] CME scrape failed: {e}")
        return None

def _fedwatch_fallback():
    """No live probabilities — return an honest labeled placeholder built from FRED."""
    cur_range = _current_fed_target_from_fred() or (350, 375)
    effr = _current_effr_from_fred()
    lo, hi = cur_range
    # Concentrated "no change" prior; do NOT pretend to be CME.
    probs = {
        f"{lo-25}-{hi-25}": 30.0,
        f"{lo}-{hi}":       55.0,
        f"{lo+25}-{hi+25}": 15.0,
    }
    probs = dict(sorted(probs.items(), key=lambda x: int(x[0].split('-')[0])))
    most_likely = max(probs.items(), key=lambda x: x[1])
    return {
        "next_meeting_date": "TBD",
        "target_rate_probabilities": probs,
        "most_likely_change": most_likely[0],
        "most_likely_probability": most_likely[1],
        "current_target_rate": f"{lo}-{hi}",
        "current_fed_rate": round(effr, 2) if effr is not None else None,
        "source": "Indicative — CME feed unavailable",
        "note": "Live CME FedWatch feed unreachable. Values below are heuristic, not market-implied.",
    }

def fetch_fedwatch_data():
    live = _scrape_cme_fedwatch()
    if live:
        return live
    return _fedwatch_fallback()


# ============================================================
# Generic cached endpoint wrapper
# ============================================================
def _serve_cached(kind, fetcher):
    cached = get_cached_data(kind)
    if cached:
        return jsonify(cached)

    csv_data = load_from_cache(kind)
    if csv_data:
        set_cached_data(kind, csv_data)

        def bg():
            try:
                fresh = fetcher()
                if fresh and 'error' not in fresh:
                    changed = compare_data(csv_data, fresh)
                    save_to_cache(kind, fresh, data_changed=changed)
                    set_cached_data(kind, fresh)
            except Exception as e:
                print(f"[bg {kind}] {e}")

        threading.Thread(target=bg, daemon=True).start()
        return jsonify(csv_data)

    fresh = fetcher()
    if isinstance(fresh, dict) and 'error' in fresh:
        return jsonify(fresh), 400
    save_to_cache(kind, fresh, data_changed=False)
    set_cached_data(kind, fresh)
    return jsonify(fresh)


@app.route('/api/macro')
def macro_data():
    try:
        return _serve_cached('macro', fetch_macro_data)
    except Exception as e:
        return jsonify({"error": f"Internal server error: {e}"}), 500

@app.route('/api/rates')
def rates_analysis():
    try:
        return _serve_cached('rates', fetch_rates_data)
    except Exception as e:
        return jsonify({"error": f"Internal server error: {e}"}), 500

@app.route('/api/fedwatch')
def fedwatch_data():
    try:
        return _serve_cached('fedwatch', fetch_fedwatch_data)
    except Exception as e:
        return jsonify({"error": f"Internal server error: {e}"}), 500


# ============================================================
# Admin
# ============================================================
@app.route('/api/update-cache')
def manual_update_cache():
    results = {}
    for kind, fn in (('macro', fetch_macro_data), ('rates', fetch_rates_data), ('fedwatch', fetch_fedwatch_data)):
        try:
            data = fn()
            if isinstance(data, dict) and 'error' in data:
                results[kind] = {'status': 'error', 'message': data['error']}
            else:
                save_to_cache(kind, data, data_changed=True)
                set_cached_data(kind, data)
                results[kind] = {'status': 'success'}
        except Exception as e:
            results[kind] = {'status': 'error', 'message': str(e)}
    return jsonify({'results': results, 'timestamp': datetime.now().isoformat()})

@app.route('/api/cache-status')
def cache_status():
    status = {}
    for k in ('macro', 'rates', 'fedwatch'):
        age = get_cache_age(k)
        status[k] = {'valid': is_cache_valid(k), 'age_days': age, 'needs_update': not is_cache_valid(k)}
    return jsonify({'cache_status': status, 'fred_api_key_set': FRED_API_KEY != "YOUR_API_KEY_HERE"})

@app.route('/api/clear-cache')
def clear_cache_endpoint():
    from cache_manager import clear_cache
    try:
        clear_cache()
        return jsonify({'message': 'Cache cleared'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================================
# Frontend
# ============================================================
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path.startswith('api/'):
        return jsonify({"error": "API endpoint not found"}), 404
    file_path = os.path.join(app.static_folder, path) if path else os.path.join(app.static_folder, 'index.html')
    if path and os.path.isfile(file_path):
        return send_from_directory(app.static_folder, path)
    index_path = os.path.join(app.static_folder, 'index.html')
    if os.path.exists(index_path):
        return send_from_directory(app.static_folder, 'index.html')
    return jsonify({"error": "Frontend not built"}), 404


# ============================================================
# Cache prewarm + background refresh
# ============================================================
def prewarm_cache():
    for kind, fn in (('macro', fetch_macro_data), ('rates', fetch_rates_data), ('fedwatch', fetch_fedwatch_data)):
        if is_cache_valid(kind):
            data = load_from_cache(kind)
            if data:
                set_cached_data(kind, data)
                continue
        try:
            data = fn()
            if isinstance(data, dict) and 'error' in data:
                continue
            save_to_cache(kind, data, data_changed=False)
            set_cached_data(kind, data)
        except Exception as e:
            print(f"[prewarm {kind}] {e}")

def update_data_worker():
    time.sleep(60)
    while True:
        try:
            for kind, fn in (('macro', fetch_macro_data), ('rates', fetch_rates_data), ('fedwatch', fetch_fedwatch_data)):
                if not is_cache_valid(kind):
                    try:
                        data = fn()
                        if not (isinstance(data, dict) and 'error' in data):
                            save_to_cache(kind, data, data_changed=True)
                            set_cached_data(kind, data)
                    except Exception as e:
                        print(f"[worker {kind}] {e}")
            time.sleep(43200)
        except Exception as e:
            print(f"[worker] {e}")
            time.sleep(3600)


if __name__ == '__main__':
    threading.Thread(target=prewarm_cache, daemon=True).start()
    time.sleep(1)
    threading.Thread(target=update_data_worker, daemon=True).start()
    port = int(os.environ.get('PORT', 5001))
    debug = os.getenv("FLASK_DEBUG", "0") == "1"
    app.run(debug=debug, host='0.0.0.0', port=port)
