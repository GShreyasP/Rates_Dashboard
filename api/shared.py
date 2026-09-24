"""
Shared logic for Vercel serverless functions.

FRED data is fetched via direct JSON HTTP calls in parallel — much faster
than pandas_datareader and no heavy deps. Vercel's Python runtime has a
tiny cold-start budget, so we keep imports minimal.

Per-invocation in-memory cache lives for the life of a warm Lambda; edge
caching (Cache-Control: s-maxage) handles cross-invocation reuse.
"""

import os
import json
import time
import threading
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

FRED_API_KEY = os.getenv("FRED_API_KEY", "").strip()
FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"
HTTP_TIMEOUT = 8

# Warm-lambda memo. Only used within a single container.
_MEMO = {}
_MEMO_LOCK = threading.Lock()
_MEMO_TTL = 300  # 5 min


def _api_key_ok():
    return len(FRED_API_KEY) >= 10 and FRED_API_KEY != "YOUR_API_KEY_HERE"


def memoize(key, ttl=_MEMO_TTL):
    """Decorator: warm-container memoization."""
    def deco(fn):
        def wrapped(*a, **kw):
            with _MEMO_LOCK:
                hit = _MEMO.get(key)
                if hit and time.time() - hit["t"] < ttl:
                    return hit["v"]
            v = fn(*a, **kw)
            with _MEMO_LOCK:
                _MEMO[key] = {"t": time.time(), "v": v}
            return v
        return wrapped
    return deco


# ============================================================
# FRED
# ============================================================
def fred_observations(series_id, start=None, end=None, session=None):
    if not _api_key_ok():
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
    out = []
    for o in r.json().get("observations", []):
        v = o.get("value")
        if v in (None, "", "."):
            continue
        try:
            out.append({"date": o["date"], "value": float(v)})
        except ValueError:
            continue
    return out


# ============================================================
# Yields
# ============================================================
FRED_YIELD_SERIES = {
    '1M':  'DGS1MO', '3M':  'DGS3MO', '6M':  'DGS6MO',
    '1Y':  'DGS1',   '2Y':  'DGS2',   '3Y':  'DGS3',
    '5Y':  'DGS5',   '7Y':  'DGS7',   '10Y': 'DGS10',
    '20Y': 'DGS20',  '30Y': 'DGS30',
}


def maturity_to_years(m):
    if m.endswith('W'): return int(m[:-1]) / 52.0
    if m.endswith('M'): return int(m[:-1]) / 12.0
    if m.endswith('Y'): return float(m[:-1])
    return 0.0


def calculate_dv01(face_value, duration, _yield_pct):
    return duration * 0.0001 * face_value


@memoize("yields")
def get_yield_curve():
    end = datetime.now().date()
    start = end - timedelta(days=30)
    session = requests.Session()
    out = {}

    def one(label, sid):
        try:
            obs = fred_observations(sid, start, end, session=session)
            if obs:
                return label, obs[-1]["value"]
        except Exception as e:
            print(f"[yield {label}] {e}")
        return label, None

    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = [ex.submit(one, l, s) for l, s in FRED_YIELD_SERIES.items()]
        for f in as_completed(futures):
            label, val = f.result()
            if val is not None:
                out[label] = val
    return out


# ============================================================
# Macro
# ============================================================
MACRO_SERIES = {
    "CPI":                 "CPIAUCSL",
    "PCE Headline":        "PCEPI",
    "PCE Core":            "PCEPILFE",   # PCE excluding food & energy (true core)
    "PPI":                 "PPIFIS",     # PPI Final Demand (the headline print)
    "PMI":                 "NAPM",
    "Non-Farm Payrolls":   "PAYEMS",
    "Unemployment Rate":   "UNRATE",
    "Unemployment Claims": "ICSA",
    "JOLTS":               "JTSJOL",
    "Consumer Sentiment":  "UMCSENT",
    "Consumer Confidence": "CONCCONF",
}
PMI_FALLBACKS = ["MANPMI"]
YOY_SERIES = {"CPI", "PCE Headline", "PCE Core", "PPI", "Non-Farm Payrolls", "JOLTS"}
QOQ_SERIES = {"CPI", "PCE Headline", "PCE Core", "PPI"}


def _closest_on_or_before(obs, target_date_str):
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
    dedup = {}
    for o in obs:
        dedup[o["date"]] = o["value"]
    obs = [{"date": d, "value": v} for d, v in dedup.items()]
    obs.sort(key=lambda o: o["date"])

    hist = []
    prev_v = None
    for o in obs:
        pct = 0.0 if prev_v in (None, 0) else (o["value"] - prev_v) / prev_v * 100
        # 'previous' is used by the frontend as the "expected" proxy (last known reading).
        hist.append({
            "date": o["date"],
            "value": o["value"],
            "previous": prev_v,
            "pct_change": round(pct, 2),
        })
        prev_v = o["value"]

    latest = obs[-1]["value"]
    latest_date = obs[-1]["date"]
    prev = obs[-2]["value"] if len(obs) > 1 else latest
    change = 0.0 if prev == 0 else (latest - prev) / prev * 100

    payload = {
        "history": hist,
        "current": latest,
        "latest_date": latest_date,
        "previous": prev,
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


@memoize("macro", ttl=1800)
def fetch_macro_data():
    if not _api_key_ok():
        return {"error": "Missing FRED API Key"}
    session = requests.Session()
    start = datetime.now() - timedelta(days=550)
    end = datetime.now() + timedelta(days=60)
    out = {}

    def one(name, sid):
        candidates = [sid] + (PMI_FALLBACKS if name == "PMI" else [])
        for cand in candidates:
            try:
                obs = fred_observations(cand, start, end, session=session)
                if obs:
                    return name, _build_series_payload(name, obs)
            except Exception as e:
                print(f"[macro {name}/{cand}] {e}")
        return name, None

    with ThreadPoolExecutor(max_workers=10) as ex:
        futures = [ex.submit(one, n, s) for n, s in MACRO_SERIES.items()]
        for f in as_completed(futures):
            name, payload = f.result()
            if payload:
                out[name] = payload
    return out


# ============================================================
# Rates analysis
# ============================================================
@memoize("rates")
def fetch_rates_data():
    yields = get_yield_curve()
    if not yields:
        return {
            "yields": {}, "yield_curve": [],
            "analysis": {"spread_2s10s": 0, "spread_5s30s": 0,
                         "curve_shape": "Unknown", "trade_pitch": "Data unavailable",
                         "dv01_10m_position": "$0.00"},
            "error": "Failed to fetch yields",
        }

    short = yields.get('2Y') or yields.get('1Y') or yields.get('3M', 0)
    spread_2s10s = yields.get('10Y', 0) - short
    spread_5s30s = yields.get('30Y', 0) - yields.get('5Y', 0)

    if spread_2s10s < 0:
        curve_shape, pitch = "Inverted", "Bull Steepener (Expecting cuts)"
    elif spread_2s10s < 0.5:
        curve_shape, pitch = "Flat", "Range-bound; watch macro prints"
    else:
        curve_shape, pitch = "Normal", "Bear Flattener (Rates rising)"

    dv01 = calculate_dv01(10_000_000, 8.0, yields.get('10Y', 4.0))
    sorted_y = dict(sorted(yields.items(), key=lambda x: maturity_to_years(x[0])))
    curve = [{"maturity": k, "years": maturity_to_years(k), "yield": v}
             for k, v in sorted_y.items()]

    return {
        "yields": sorted_y,
        "yield_curve": curve,
        "analysis": {
            "spread_2s10s": round(spread_2s10s, 2),
            "spread_5s30s": round(spread_5s30s, 2),
            "curve_shape": curve_shape,
            "trade_pitch": pitch,
            "dv01_10m_position": f"${dv01:,.2f}",
        }
    }


# ============================================================
# FedWatch — heuristic estimate from FRED.
#
# CME's real FedWatch feed is only available by scraping their site,
# which they block via IP + explicitly prohibit under their Terms of
# Use. Rather than fight that, we compute a transparent directional
# estimate from the short-end Treasury curve and label it clearly.
# For live market-implied probabilities, users go to CME's own tool.
# ============================================================

# FOMC meeting decision dates (day 2 of each meeting). Extend as needed.
FOMC_MEETINGS = [
    "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17",
    "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
    "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-16",
    "2027-07-28", "2027-09-15", "2027-10-27", "2027-12-08",
]


def _current_fed_target():
    """Returns (lower_bps, upper_bps) or None."""
    try:
        up = fred_observations("DFEDTARU", datetime.now() - timedelta(days=30), datetime.now())
        lo = fred_observations("DFEDTARL", datetime.now() - timedelta(days=30), datetime.now())
        if up and lo:
            return int(round(lo[-1]["value"] * 100)), int(round(up[-1]["value"] * 100))
    except Exception as e:
        print(f"[fed target] {e}")
    return None


def _current_effr():
    try:
        obs = fred_observations("DFF", datetime.now() - timedelta(days=15), datetime.now())
        if obs:
            return obs[-1]["value"]
    except Exception:
        pass
    return None


def _short_end_yield():
    """Use 3M T-bill (DGS3MO) as the short-end proxy for market-implied direction."""
    try:
        obs = fred_observations("DGS3MO", datetime.now() - timedelta(days=15), datetime.now())
        if obs:
            return obs[-1]["value"]
    except Exception:
        pass
    return None


def _next_meeting_date():
    today = datetime.now().date().isoformat()
    upcoming = [m for m in FOMC_MEETINGS if m >= today]
    return upcoming[0] if upcoming else None


@memoize("fedwatch", ttl=1800)
def fetch_fedwatch_data():
    """
    Estimate the next FOMC's target-rate distribution from FRED.

    Method (deliberately simple, transparent, no CME data):
      1. Get current Fed target range (DFEDTARL/DFEDTARU) and EFFR (DFF).
      2. Compare 3M T-bill yield (DGS3MO) to the target midpoint.
         The short bill mostly prices in the next 1-2 meetings.
      3. If short yield >> target: market leans hike. If <<: market leans cut.
         Linear tilt over ±25bp around the current bucket.
    """
    cur_range = _current_fed_target() or (350, 375)
    lo, hi = cur_range
    mid_pct = (lo + hi) / 200.0  # convert bps to %

    effr = _current_effr()
    short = _short_end_yield()

    # Directional tilt from short-end vs current target midpoint.
    # >0 => hike-leaning; <0 => cut-leaning; ~0 => hold.
    if short is not None:
        tilt = short - mid_pct  # in %; ~0.25 = fully one hike priced in
    else:
        tilt = 0.0

    # Cap tilt at ±25bp for the distribution; anything larger just concentrates
    # probability in the adjacent bucket.
    t = max(-0.25, min(0.25, tilt)) / 0.25  # normalized to [-1, +1]

    # Base weights for HOLD, HIKE, CUT, tilted by t.
    if t >= 0:
        p_hold = round(0.70 - 0.35 * t, 3)
        p_hike = round(0.10 + 0.55 * t, 3)
        p_cut  = round(1.0 - p_hold - p_hike, 3)
    else:
        p_hold = round(0.70 + 0.35 * t, 3)  # t is negative here
        p_cut  = round(0.10 - 0.55 * t, 3)
        p_hike = round(1.0 - p_hold - p_cut, 3)

    p_hold, p_hike, p_cut = (max(0.02, p) for p in (p_hold, p_hike, p_cut))
    total = p_hold + p_hike + p_cut
    p_hold, p_hike, p_cut = (round(p * 100 / total, 2) for p in (p_hold, p_hike, p_cut))

    probs = {
        f"{lo-25}-{hi-25}": p_cut,
        f"{lo}-{hi}":       p_hold,
        f"{lo+25}-{hi+25}": p_hike,
    }
    probs = dict(sorted(probs.items(), key=lambda x: int(x[0].split('-')[0])))
    most_likely = max(probs.items(), key=lambda x: x[1])

    nxt_iso = _next_meeting_date()
    nxt_display = "TBD"
    if nxt_iso:
        nxt_display = datetime.strptime(nxt_iso, "%Y-%m-%d").strftime("%d %b %Y")

    return {
        "next_meeting_date": nxt_display,
        "target_rate_probabilities": probs,
        "most_likely_change": most_likely[0],
        "most_likely_probability": most_likely[1],
        "current_target_rate": f"{lo}-{hi}",
        "current_fed_rate": round(effr, 2) if effr is not None else None,
        "short_end_yield": round(short, 3) if short is not None else None,
        "meetings": [],
        "source": "Heuristic — 3M T-bill vs. Fed target (FRED)",
        "note": "Estimate only. For market-implied probabilities, see CME FedWatch: "
                "https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html",
    }


