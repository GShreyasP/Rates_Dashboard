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
# FedWatch — computed from CME Fed Funds futures (ZQ), which
# is the same input CME uses to publish the FedWatch tool.
# ============================================================
CME_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/121.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html",
    "Origin": "https://www.cmegroup.com",
}
# 30-Day Fed Funds futures. Product 305, listing group "G".
CME_ZQ_URL = "https://www.cmegroup.com/CmeWS/mvc/Quotes/Future/305/G"

# FOMC meeting decision dates (day 2 of each meeting). Extend as needed.
FOMC_MEETINGS = [
    "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17",
    "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
    "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-16",
    "2027-07-28", "2027-09-15", "2027-10-27", "2027-12-08",
]

# CME futures month codes
MONTH_CODE = {'F': 1, 'G': 2, 'H': 3, 'J': 4, 'K': 5, 'M': 6,
              'N': 7, 'Q': 8, 'U': 9, 'V': 10, 'X': 11, 'Z': 12}


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


def _parse_zq_last(quote):
    """CME 'last' can be a string like '95.9600' or missing. Return float or None."""
    for k in ("last", "priorSettle", "settle", "prior"):
        v = quote.get(k)
        if v in (None, "", "-"):
            continue
        try:
            return float(str(v).replace(",", ""))
        except ValueError:
            continue
    return None


def _fetch_zq_curve():
    """Returns dict {(year, month): implied_rate_pct}. Empty on failure."""
    try:
        r = requests.get(CME_ZQ_URL, headers=CME_HEADERS, timeout=HTTP_TIMEOUT)
        r.raise_for_status()
        payload = r.json()
    except Exception as e:
        print(f"[zq] fetch failed: {e}")
        return {}

    quotes = payload.get("quotes") if isinstance(payload, dict) else None
    if not quotes:
        return {}

    curve = {}
    for q in quotes:
        code = q.get("quoteCode") or q.get("code") or ""
        # ZQ<month><year>, e.g. ZQV6 = Oct 2026, ZQF7 = Jan 2027.
        if not code.startswith("ZQ") or len(code) < 4:
            continue
        month_char = code[2]
        year_digit = code[3:]
        if month_char not in MONTH_CODE or not year_digit.isdigit():
            continue
        m = MONTH_CODE[month_char]
        # Convert single-digit year to full year (bias toward current decade)
        this_year = datetime.now().year
        yd = int(year_digit)
        # Try nearest full year matching last digit(s)
        base_decade = (this_year // 10) * 10
        candidates = [base_decade + yd, base_decade + yd + 10, base_decade + yd - 10]
        y = min(candidates, key=lambda cy: abs(cy - this_year))
        price = _parse_zq_last(q)
        if price is None:
            continue
        curve[(y, m)] = round(100.0 - price, 4)
    return curve


def _days_in_month(y, m):
    if m == 12:
        return 31
    return (datetime(y, m + 1, 1) - datetime(y, m, 1)).days


def _implied_post_meeting_rate(zq, meeting_date, current_rate):
    """
    CME FedWatch method: for a meeting in month M on day D,
    price_M = avg daily FF rate over M
            = (D-1)/N * R_pre + (N - D + 1)/N * R_post
    R_pre = the effective rate that will prevail on days 1..D-1 of month M
          = R from the previous FOMC (or current rate if the previous meeting was in an earlier month).
    We approximate R_pre with the current EFFR (or the implied rate from month M-1's ZQ if that month has no meeting).
    Returns implied post-meeting rate (%) or None.
    """
    y, m, d = meeting_date.year, meeting_date.month, meeting_date.day
    key = (y, m)
    if key not in zq:
        return None
    price_m = zq[key]  # avg implied rate over month m
    n = _days_in_month(y, m)

    # R_pre approximation: implied rate from month M-1 futures (if available)
    prev_key = (y, m - 1) if m > 1 else (y - 1, 12)
    r_pre = zq.get(prev_key, current_rate)

    # price_m = (d-1)/n * r_pre + (n - d + 1)/n * r_post
    r_post = (price_m * n - (d - 1) * r_pre) / (n - d + 1)
    return r_post


def _implied_rate_to_probs(implied, current_range):
    """
    Distribute implied rate over adjacent 25bp target-rate buckets.

    current_range = (lower_bps, upper_bps). Buckets are ±3 steps (25bp) around current.
    We use a two-bucket linear interpolation centered on the implied rate,
    which is the standard textbook way to convert implied FF to target-rate probs.
    """
    lo, hi = current_range
    mid = (lo + hi) / 2.0  # bps
    implied_bps = implied * 100

    # Which two 25bp midpoints bracket implied?
    # Bucket midpoints are ..., mid-25, mid, mid+25, ...
    step = 25.0
    k = (implied_bps - mid) / step
    k_lo = int(k // 1)  # floor
    k_hi = k_lo + 1
    frac = k - k_lo

    def bucket_range(k_idx):
        center = mid + k_idx * step
        return int(round(center - 12.5)), int(round(center + 12.5))

    b_lo = bucket_range(k_lo)
    b_hi = bucket_range(k_hi)

    probs = {
        f"{b_lo[0]}-{b_lo[1]}": round((1 - frac) * 100, 2),
        f"{b_hi[0]}-{b_hi[1]}": round(frac * 100, 2),
    }
    # Drop zero buckets
    probs = {k_: v for k_, v in probs.items() if v > 0.05}
    # Renormalize
    total = sum(probs.values())
    if total > 0:
        probs = {k_: round(v * 100 / total, 2) for k_, v in probs.items()}
    return probs


def _upcoming_meetings(n=8):
    today = datetime.now().date().isoformat()
    upcoming = [m for m in FOMC_MEETINGS if m >= today]
    return upcoming[:n]


@memoize("fedwatch", ttl=900)
def fetch_fedwatch_data():
    cur_range = _current_fed_target() or (350, 375)
    effr = _current_effr()
    zq = _fetch_zq_curve()
    meetings = _upcoming_meetings()

    meeting_payloads = []
    if zq and effr is not None:
        for m_str in meetings:
            md = datetime.strptime(m_str, "%Y-%m-%d")
            implied = _implied_post_meeting_rate(zq, md, effr)
            if implied is None:
                continue
            probs = _implied_rate_to_probs(implied, cur_range)
            if not probs:
                continue
            probs = dict(sorted(probs.items(), key=lambda x: int(x[0].split('-')[0])))
            most_likely = max(probs.items(), key=lambda x: x[1])
            meeting_payloads.append({
                "date": md.strftime("%d %b %Y"),
                "date_iso": m_str,
                "implied_rate": round(implied, 3),
                "target_rate_probabilities": probs,
                "most_likely_change": most_likely[0],
                "most_likely_probability": most_likely[1],
            })

    if not meeting_payloads:
        # Honest placeholder — do NOT pretend to be CME.
        lo, hi = cur_range
        probs = {
            f"{lo-25}-{hi-25}": 30.0,
            f"{lo}-{hi}":       55.0,
            f"{lo+25}-{hi+25}": 15.0,
        }
        probs = dict(sorted(probs.items(), key=lambda x: int(x[0].split('-')[0])))
        ml = max(probs.items(), key=lambda x: x[1])
        upcoming = _upcoming_meetings(1)
        next_date = "TBD"
        if upcoming:
            next_date = datetime.strptime(upcoming[0], "%Y-%m-%d").strftime("%d %b %Y")
        return {
            "next_meeting_date": next_date,
            "target_rate_probabilities": probs,
            "most_likely_change": ml[0],
            "most_likely_probability": ml[1],
            "current_target_rate": f"{lo}-{hi}",
            "current_fed_rate": round(effr, 2) if effr is not None else None,
            "meetings": [],
            "source": "Indicative — CME feed unavailable",
            "note": "Live CME Fed Funds futures feed unreachable. Values are heuristic, not market-implied.",
        }

    # Next-meeting fields (for the existing frontend card)
    nxt = meeting_payloads[0]
    return {
        "next_meeting_date": nxt["date"],
        "target_rate_probabilities": nxt["target_rate_probabilities"],
        "most_likely_change": nxt["most_likely_change"],
        "most_likely_probability": nxt["most_likely_probability"],
        "current_target_rate": f"{cur_range[0]}-{cur_range[1]}",
        "current_fed_rate": round(effr, 2) if effr is not None else None,
        "meetings": meeting_payloads,
        "source": "Computed from CME Fed Funds futures (ZQ)",
    }


