import os
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
import pandas_datareader.data as web
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
import numpy as np
import threading
import requests
from bs4 import BeautifulSoup
import time
from cache_manager import (
    is_cache_valid, load_from_cache, save_to_cache, 
    get_cache_age, CACHE_DIR, check_data_changed, clear_data_changed_flag
)

# Load environment variables from .env file
load_dotenv()

# Determine static folder path - try multiple locations
static_folder_path = None
possible_paths = [
    'dist',  # If copied to Backend/dist (Render build)
    '../Frontend/frontend/dist',  # Local development
    '../../Frontend/frontend/dist',  # Alternative
    'Frontend/frontend/dist',  # Another alternative
]

for path in possible_paths:
    full_path = os.path.join(os.path.dirname(__file__), path) if not os.path.isabs(path) else path
    if os.path.exists(full_path) and os.path.isdir(full_path):
        static_folder_path = full_path
        break

# If no dist folder found, create a placeholder
if static_folder_path is None:
    static_folder_path = os.path.join(os.path.dirname(__file__), 'static')
    os.makedirs(static_folder_path, exist_ok=True)
    # Create a simple index.html placeholder
    index_file = os.path.join(static_folder_path, 'index.html')
    if not os.path.exists(index_file):
        with open(index_file, 'w') as f:
            f.write('''<!DOCTYPE html>
<html>
<head><title>Rates Dashboard</title></head>
<body>
<h1>Frontend not built</h1>
<p>Backend API is running. Please deploy frontend separately as a static site.</p>
<p>API endpoints are available at:</p>
<ul>
<li><a href="/api/fedwatch">/api/fedwatch</a></li>
<li><a href="/api/rates">/api/rates</a></li>
<li><a href="/api/macro">/api/macro</a></li>
</ul>
</body>
</html>''')

app = Flask(__name__, static_folder=static_folder_path, static_url_path='/')
CORS(app)  # Allow React to talk to Flask in dev

# --- CONFIGURATION ---
# Get API Key from environment variable (loads from .env file or system env)
FRED_API_KEY = os.getenv("FRED_API_KEY", "YOUR_API_KEY_HERE")

# --- CACHING ---
# CSV-based persistent cache (updates every 3 days)
# Keep in-memory cache for faster repeated requests within the same session
CACHE_DURATION = timedelta(minutes=5)
memory_cache = {
    'macro': {'data': None, 'timestamp': None},
    'rates': {'data': None, 'timestamp': None},
    'fedwatch': {'data': None, 'timestamp': None}
}
cache_lock = threading.Lock()

def get_cached_data(key):
    """Get cached data from memory cache if it's still valid (short-term cache)"""
    with cache_lock:
        cached = memory_cache.get(key)
        if cached and cached['data'] and cached['timestamp']:
            age = datetime.now() - cached['timestamp']
            if age < CACHE_DURATION:
                return cached['data']
    return None

def set_cached_data(key, data):
    """Store data in memory cache (short-term)"""
    with cache_lock:
        memory_cache[key] = {'data': data, 'timestamp': datetime.now()}

def compare_data(old_data, new_data):
    """Compare two data objects to detect if there are meaningful changes"""
    import json
    if old_data is None or new_data is None:
        return False
    
    # Convert to JSON strings for deep comparison (handles nested dicts)
    old_str = json.dumps(old_data, sort_keys=True, default=str)
    new_str = json.dumps(new_data, sort_keys=True, default=str)
    
    # For numeric comparison, we'll do a smarter comparison
    # For now, simple string comparison works for detecting changes
    return old_str != new_str 

# --- HELPER FUNCTIONS ---
def get_yield_curve():
    """
    Fetch yield curve data from multiple sources:
    - yfinance for some maturities
    - FRED API for Treasury constant maturity rates
    """
    data = {}
    
    # Yahoo Finance tickers (existing ones)
    # Note: 13W removed from yield curve as requested
    yf_tickers = {
        '5Y': '^FVX',   # 5-year Treasury Note
        '10Y': '^TNX',  # 10-year Treasury Note
        '30Y': '^TYX'   # 30-year Treasury Bond
    }
    
    # Fetch from yfinance
    try:
        for label, ticker in yf_tickers.items():
            try:
                tick = yf.Ticker(ticker)
                hist = tick.history(period="1d")
                if not hist.empty:
                    # Yahoo yields are prices (e.g., 4.5), we keep them as is for display
                    data[label] = float(hist['Close'].iloc[-1])
            except Exception as e:
                print(f"Error fetching {label} ({ticker}) from yfinance: {e}")
    except Exception as e:
        print(f"Error fetching yields from yfinance: {e}")
    
    # FRED API Treasury constant maturity rates
    # FRED series IDs for Treasury yields
    fred_series = {
        '1M': 'DGS1MO',   # 1-month
        '2M': 'DGS2MO',   # 2-month
        '3M': 'DGS3MO',   # 3-month
        '4M': 'DGS4MO',   # 4-month (may not exist, will skip if unavailable)
        '6M': 'DGS6MO',   # 6-month
        '1Y': 'DGS1',     # 1-year
        '2Y': 'DGS2',     # 2-year
        '7Y': 'DGS7'      # 7-year
    }
    
    # Fetch from FRED API if key is available
    if FRED_API_KEY != "YOUR_API_KEY_HERE":
        try:
            # Get recent data (last 5 days to ensure we get the latest)
            end_date = datetime.now()
            start_date = end_date - timedelta(days=5)
            
            for label, series_id in fred_series.items():
                try:
                    df = web.DataReader(series_id, 'fred', start_date, end_date, api_key=FRED_API_KEY)
                    if not df.empty:
                        # Get the most recent non-NaN value
                        series_data = df[series_id].dropna()
                        if len(series_data) > 0:
                            data[label] = float(series_data.iloc[-1])
                        else:
                            print(f"Warning: No valid data for {label} ({series_id})")
                    else:
                        print(f"Warning: Empty dataframe for {label} ({series_id})")
                except Exception as e:
                    print(f"Error fetching {label} ({series_id}) from FRED: {e}")
        except Exception as e:
            print(f"Error fetching yields from FRED: {e}")
    else:
        print("Warning: FRED_API_KEY not set, skipping FRED yield data")
    
    return data

def calculate_dv01(face_value, duration, yield_percent):
    # Modified Duration adjustment not needed for rough DV01 approx in this context
    # DV01 = Duration * 0.0001 * Price (approx Face Value)
    return duration * 0.0001 * face_value

def maturity_to_years(maturity_str):
    """Convert maturity string to years for sorting (e.g., '13W' -> 0.25, '2Y' -> 2)"""
    if maturity_str.endswith('W'):
        weeks = int(maturity_str[:-1])
        return weeks / 52.0
    elif maturity_str.endswith('M'):
        months = int(maturity_str[:-1])
        return months / 12.0
    elif maturity_str.endswith('Y'):
        years = int(maturity_str[:-1])
        return float(years)
    return 0.0

# --- API ENDPOINTS ---

def fetch_macro_data():
    """Fetch macro data from FRED (used for caching) - optimized with parallel fetching"""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    
    # Series IDs organized by category
    # Inflation Indicators
    # Producer Price Indicators  
    # Employment Indicators
    # Manufacturing Activity & Consumer Sentiment
    series_map = {
        "CPI": "CPIAUCSL",  # Consumer Price Index
        "PCE Headline": "PCEPI",     # Personal Consumption Expenditures Price Index (Headline)
        "PCE Core": "PCECTPI",  # PCE Price Index excluding food and energy (Core)
        "PPI": "PPIACO",    # Producer Price Index
        "PMI": "NAPM",  # ISM Manufacturing PMI - will try alternative if this fails
        "Non-Farm Payrolls": "PAYEMS",  # Non-Farm Payrolls (Total Nonfarm)
        "Unemployment Rate": "UNRATE",  # Unemployment Rate
        "Unemployment Claims": "ICSA",  # Initial Jobless Claims, Seasonally Adjusted
        "JOLTS": "JTSJOL",  # Job Openings: Total Nonfarm (JOLTS)
        "Consumer Sentiment": "UMCSENT",  # University of Michigan Consumer Sentiment
        "Consumer Confidence": "CONCCONF",  # Consumer Confidence Index
    }
    
    # Alternative PMI series IDs to try if primary fails
    pmi_alternatives = ["MANPMI", "UMCSENT"]  # Manufacturing PMI alternatives
    
    response_data = {}
    # Historical data from 18 months ago to reduce load time while maintaining context
    start_date = datetime.now() - timedelta(days=550)  # ~18 months
    
    if FRED_API_KEY == "YOUR_API_KEY_HERE":
        return {"error": "Missing FRED API Key"}

    try:
        # Get data up to today + 1 month to ensure we capture the latest available data
        # FRED data is typically released mid-month for the previous month
        end_date = datetime.now() + timedelta(days=60)  # Look ahead to catch latest releases
        
        def fetch_series(name, series_id):
            """Helper function to fetch a single series"""
            try:
                # For PMI, try alternatives if primary fails
                if name == "PMI":
                    df = None
                    for alt_id in [series_id] + pmi_alternatives:
                        try:
                            df = web.DataReader(alt_id, 'fred', start_date, end_date, api_key=FRED_API_KEY)
                            df = df.reset_index()
                            series_id = alt_id  # Use the working series ID
                            break
                        except:
                            continue
                    if df is None or len(df) == 0:
                        print(f"Warning: Could not fetch PMI data with any series ID")
                        return None
                else:
                    # Fetch data from FRED - pandas_datareader will get the latest available data
                    df = web.DataReader(series_id, 'fred', start_date, end_date, api_key=FRED_API_KEY)
                    df = df.reset_index()
                
                # Drop any NaN values that might be at the end (future dates without data yet)
                df = df.dropna(subset=[series_id])
                
                if len(df) == 0:
                    print(f"Warning: No data found for {name} ({series_id})")
                    return None
                
                # Sort by date to ensure chronological order
                df = df.sort_values('DATE')
                
                # Remove any duplicate dates (keep last)
                df = df.drop_duplicates(subset='DATE', keep='last')
                
                df['date'] = df['DATE'].dt.strftime('%Y-%m-%d')
                
                # Calculate percent change for each data point (period-over-period)
                df['pct_change'] = df[series_id].pct_change() * 100
                df['pct_change'] = df['pct_change'].fillna(0)  # First row will be 0 (no previous value)
                
                # Calculate simple numeric display data
                latest = float(df[series_id].iloc[-1])
                latest_date = df['date'].iloc[-1]
                prev = float(df[series_id].iloc[-2]) if len(df) > 1 else latest
                change = ((latest - prev) / prev) * 100 if prev != 0 else 0
                
                # Calculate Year-over-Year (YoY) change for CPI, PCE Headline, PCE Core, PPI, Non-Farm Payrolls, JOLTS
                yoy_change = None
                if name in ["CPI", "PCE Headline", "PCE Core", "PPI", "Non-Farm Payrolls", "JOLTS"]:
                    # Always calculate YoY for these indicators
                    try:
                        # Find value from 1 year ago (approximately 365 days)
                        latest_date_obj = pd.to_datetime(latest_date)
                        one_year_ago = latest_date_obj - pd.DateOffset(years=1)
                        
                        # Find closest date to one year ago
                        df['DATE_dt'] = pd.to_datetime(df['DATE'])
                        one_year_data = df[df['DATE_dt'] <= one_year_ago]
                        
                        if len(one_year_data) > 0:
                            # Get the closest date to one year ago
                            one_year_value = float(one_year_data.iloc[-1][series_id])
                            yoy_change = ((latest - one_year_value) / one_year_value) * 100 if one_year_value != 0 else 0
                    except Exception as e:
                        print(f"Error calculating YoY change for {name}: {e}")
                        yoy_change = None
                
                # Calculate quarterly change for chart (for CPI, PCE Headline, PCE Core, PPI)
                quarterly_change_data = None
                if name in ["CPI", "PCE Headline", "PCE Core", "PPI"]:
                    try:
                        # Ensure DATE_dt exists (might already exist from YoY calculation)
                        if 'DATE_dt' not in df.columns:
                            df['DATE_dt'] = pd.to_datetime(df['DATE'])
                        quarterly_changes = []
                        
                        # Calculate quarterly (3-month) change for each data point
                        for idx in range(len(df)):
                            try:
                                current_date = df.iloc[idx]['DATE_dt']
                                three_months_ago = current_date - pd.DateOffset(months=3)
                                
                                # Find closest date to 3 months ago
                                past_data = df[df['DATE_dt'] <= three_months_ago]
                                
                                if len(past_data) > 0:
                                    past_value = float(past_data.iloc[-1][series_id])
                                    current_value = float(df.iloc[idx][series_id])
                                    qtr_change = ((current_value - past_value) / past_value) * 100 if past_value != 0 else 0
                                    quarterly_changes.append({
                                        'date': df.iloc[idx]['date'],
                                        'quarterly_change': round(qtr_change, 2)
                                    })
                                else:
                                    quarterly_changes.append({
                                        'date': df.iloc[idx]['date'],
                                        'quarterly_change': 0
                                    })
                            except Exception as e:
                                print(f"Error calculating quarterly change for index {idx} in {name}: {e}")
                                quarterly_changes.append({
                                    'date': df.iloc[idx]['date'],
                                    'quarterly_change': 0
                                })
                        
                        quarterly_change_data = quarterly_changes
                    except Exception as e:
                        print(f"Error calculating quarterly changes for {name}: {e}")
                        quarterly_change_data = None
                
                # Convert to native Python types for JSON serialization
                history_data = df[['date', series_id, 'pct_change']].copy()
                history_data[series_id] = history_data[series_id].astype(float)
                history_data['pct_change'] = history_data['pct_change'].astype(float).round(2)
                
                # Rename the series_id column to 'value' for easier frontend access
                history_data = history_data.rename(columns={series_id: 'value'})
                
                result_data = {
                    "history": history_data.to_dict(orient='records'),
                    "current": latest,
                    "latest_date": latest_date,
                    "change": round(change, 2)
                }
                
                # Add YoY change if calculated
                if yoy_change is not None:
                    result_data["yoy_change"] = round(yoy_change, 2)
                
                # Add quarterly change data if calculated
                if quarterly_change_data is not None:
                    result_data["quarterly_change_history"] = quarterly_change_data
                
                return {
                    'name': name,
                    'data': result_data
                }
            except Exception as e:
                print(f"Error fetching {name} ({series_id}): {str(e)}")
                return None
        
        # Fetch all series in parallel for much faster loading
        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = {executor.submit(fetch_series, name, series_id): name 
                      for name, series_id in series_map.items()}
            
            for future in as_completed(futures):
                result = future.result()
                if result:
                    response_data[result['name']] = result['data']
        
            # All series have been fetched in parallel above
    except Exception as e:
        return {"error": str(e)}
        
    return response_data

@app.route('/api/macro')
def macro_data():
    # Check memory cache first (for fast repeated requests)
    cached = get_cached_data('macro')
    if cached:
        return jsonify(cached)
    
    # ALWAYS load from cache first for fast response (even if stale)
    csv_data = load_from_cache('macro')
    if csv_data:
        # Store in memory cache for faster subsequent requests
        set_cached_data('macro', csv_data)
        
        # Always update in background after returning cached data
        def update_in_background():
            try:
                print("Background: Fetching fresh macro data from API...")
                fresh_data = fetch_macro_data()
                if 'error' not in fresh_data:
                    # Compare with cached data
                    data_changed = compare_data(csv_data, fresh_data)
                    if data_changed:
                        print("Background: Macro data has changed, updating cache...")
                    save_to_cache('macro', fresh_data, data_changed=data_changed)
                    set_cached_data('macro', fresh_data)
            except Exception as e:
                print(f"Background: Error updating macro data: {e}")
        
        # Start background update thread (non-blocking)
        threading.Thread(target=update_in_background, daemon=True).start()
        
        # Return cached data immediately (fast!)
        return jsonify(csv_data)
    
    # No cache exists - this shouldn't happen, but if it does, return error quickly
    # rather than blocking for 2 minutes fetching data
    print("WARNING: No macro cache found! Cache files should be committed to repo.")
    return jsonify({"error": "Data temporarily unavailable. Please try again in a moment."}), 503

def fetch_rates_data():
    """Fetch rates data (used for caching)"""
    yields = get_yield_curve()
    
    if not yields:
        return {"error": "Failed to fetch yields"}

    # 1. Curve Shape Analysis (2s10s and 5s30s)
    # Use 2Y if available, otherwise fall back to 1Y, then 3M
    short_term_yield = yields.get('2Y') or yields.get('1Y') or yields.get('3M', 0)
    spread_2s10s = yields.get('10Y', 0) - short_term_yield
    spread_5s30s = yields.get('30Y', 0) - yields.get('5Y', 0)
    
    curve_shape = "Normal"
    trade_pitch = "Bear Flattener (Rates rising)"
    
    if spread_2s10s < 0:
        curve_shape = "Inverted"
        trade_pitch = "Bull Steepener (Expecting cuts)"

    # 2. DV01 Example Calculation (for a standard $10M 10Y position)
    # Assuming standard 10Y duration ~8 years
    dv01 = calculate_dv01(10_000_000, 8.0, yields.get('10Y', 4.0))

    # Sort yields by maturity (convert to years for sorting)
    sorted_yields = dict(sorted(yields.items(), key=lambda x: maturity_to_years(x[0])))
    
    # Create yield curve data for charting
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
            "dv01_10m_position": f"${dv01:,.2f}"
        }
    }

@app.route('/api/rates')
def rates_analysis():
    # Check memory cache first (for fast repeated requests)
    cached = get_cached_data('rates')
    if cached:
        return jsonify(cached)
    
    # ALWAYS load from cache first for fast response (even if stale)
    csv_data = load_from_cache('rates')
    if csv_data:
        # Store in memory cache for faster subsequent requests
        set_cached_data('rates', csv_data)
        
        # Always update in background after returning cached data
        def update_in_background():
            try:
                print("Background: Fetching fresh rates data from API...")
                fresh_data = fetch_rates_data()
                if 'error' not in fresh_data:
                    # Compare with cached data
                    data_changed = compare_data(csv_data, fresh_data)
                    if data_changed:
                        print("Background: Rates data has changed, updating cache...")
                    save_to_cache('rates', fresh_data, data_changed=data_changed)
                    set_cached_data('rates', fresh_data)
            except Exception as e:
                print(f"Background: Error updating rates data: {e}")
        
        # Start background update thread (non-blocking)
        threading.Thread(target=update_in_background, daemon=True).start()
        
        # Return cached data immediately (fast!)
        return jsonify(csv_data)
    
    # No cache exists - this shouldn't happen, but if it does, return error quickly
    print("WARNING: No rates cache found! Cache files should be committed to repo.")
    return jsonify({"error": "Data temporarily unavailable. Please try again in a moment."}), 503

def fetch_fedwatch_data():
    """Fetch FedWatch interest rate cut odds - hardcoded data"""
    from datetime import datetime, timedelta
    
    # Calculate next FOMC meeting date (December 10, 2025 based on image)
    next_meeting = datetime(2025, 12, 10)
    
    # Hardcoded target rate probabilities
    # 350-375: 89.2%, 375-400: 10.8%
    target_rate_probabilities = {
        "350-375": 89.2,
        "375-400": 10.8
    }
    
    most_likely = max(target_rate_probabilities.items(), key=lambda x: x[1])
    
    return {
        "next_meeting_date": next_meeting.strftime("%B %d, %Y"),
        "target_rate_probabilities": target_rate_probabilities,
        "most_likely_change": most_likely[0],
        "most_likely_probability": round(most_likely[1], 1),
        "current_target_rate": "375-400",
        "current_fed_rate": 3.75,
        "source": "FedWatch Data"
    }

def fetch_atlanta_fed_probabilities():
    """Fetch probabilities from Atlanta Fed Market Probability Tracker (FREE)"""
    try:
        # Atlanta Fed Market Probability Tracker API endpoint
        url = "https://www.atlantafed.org/cenfis/market-probability-tracker/data"
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'application/json'
        }
        
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        
        data = response.json()
        
        # Parse Atlanta Fed data structure
        if isinstance(data, dict) and 'probabilities' in data:
            change_probs = {}
            # Get current rate if available
            current_rate_bps = data.get('currentRate', 400) * 100  # Default to 4% if not available
            
            for item in data.get('probabilities', []):
                rate_change = item.get('rateChange', 0)
                prob = item.get('probability', 0)
                change_probs[str(int(rate_change))] = prob
            
            if change_probs:
                # Convert to target rate ranges
                target_rate_probs = {}
                for change_str, prob in change_probs.items():
                    change_bps = int(change_str)
                    target_rate_lower = current_rate_bps + change_bps - 12.5
                    target_rate_upper = current_rate_bps + change_bps + 12.5
                    target_rate_lower = round(target_rate_lower / 25) * 25
                    target_rate_upper = round(target_rate_upper / 25) * 25
                    range_key = f"{int(target_rate_lower)}-{int(target_rate_upper)}"
                    target_rate_probs[range_key] = prob
                
                sorted_target_rates = dict(sorted(target_rate_probs.items(), key=lambda x: int(x[0].split('-')[0])))
                most_likely = max(sorted_target_rates.items(), key=lambda x: x[1])
                
                return {
                    "next_meeting_date": data.get('meetingDate', 'N/A'),
                    "probabilities": change_probs,
                    "target_rate_probabilities": {k: round(v * 100, 2) for k, v in sorted_target_rates.items()},
                    "most_likely_change": most_likely[0],
                    "most_likely_probability": round(most_likely[1] * 100, 2),
                    "all_probabilities": {k: round(v * 100, 2) for k, v in change_probs.items()},
                    "source": "Atlanta Fed Market Probability Tracker",
                    "current_target_rate": f"{int(current_rate_bps - 12.5)}-{int(current_rate_bps + 12.5)}"
                }
    except Exception as e:
        print(f"Error fetching Atlanta Fed data: {e}")
    
    return None

def calculate_fed_probabilities_from_rates():
    """Calculate probabilities based on current Fed Funds rate and market expectations"""
    try:
        # Get current Fed Funds rate from FRED (free)
        if FRED_API_KEY != "YOUR_API_KEY_HERE":
            try:
                # Get current effective Fed Funds rate
                current_rate_df = web.DataReader('DFF', 'fred', datetime.now() - timedelta(days=30), datetime.now(), api_key=FRED_API_KEY)
                if not current_rate_df.empty:
                    current_rate = float(current_rate_df.iloc[-1]['DFF'])
                    
                    # Get 2-year Treasury yield as proxy for market expectations
                    # The spread between 2Y yield and Fed Funds rate indicates market expectations
                    ticker_2y = yf.Ticker('^IRX')  # 13-week T-bill as short-term proxy
                    hist_2y = ticker_2y.history(period="5d")
                    
                    if not hist_2y.empty:
                        short_term_yield = float(hist_2y['Close'].iloc[-1])
                        
                        # Calculate probabilities based on yield curve expectations
                        # If short-term yields are below Fed Funds, market expects cuts
                        # If above, market expects hikes
                        spread = current_rate - short_term_yield
                        
                        # Simple probability calculation based on spread
                        # This is a simplified model - real FedWatch uses futures prices
                        # If spread is positive (current rate > market yield), market expects cuts
                        change_probs = {}
                        
                        if spread > 0.15:  # Market expects cuts (yield below Fed Funds)
                            cut_prob = min(0.75, 0.4 + spread * 1.5)
                            hike_prob = max(0.05, 0.3 - spread * 1.0)
                            no_change_prob = 1.0 - cut_prob - hike_prob
                            change_probs["-25"] = max(0.1, cut_prob)
                            change_probs["0"] = max(0.1, no_change_prob)
                            change_probs["25"] = max(0.05, hike_prob)
                        elif spread < -0.15:  # Market expects hikes (yield above Fed Funds)
                            hike_prob = min(0.75, 0.4 + abs(spread) * 1.5)
                            cut_prob = max(0.05, 0.3 - abs(spread) * 1.0)
                            no_change_prob = 1.0 - cut_prob - hike_prob
                            change_probs["-25"] = max(0.05, cut_prob)
                            change_probs["0"] = max(0.1, no_change_prob)
                            change_probs["25"] = max(0.1, hike_prob)
                        else:  # Neutral
                            change_probs["-25"] = 0.3
                            change_probs["0"] = 0.5
                            change_probs["25"] = 0.2
                        
                        # Normalize probabilities
                        total = sum(change_probs.values())
                        change_probs = {k: v/total for k, v in change_probs.items()}
                        
                        # Convert to target rate ranges (in basis points)
                        # Current rate is in percentage, convert to bps
                        current_rate_bps = current_rate * 100
                        
                        # Calculate target rate ranges
                        target_rate_probs = {}
                        for change_str, prob in change_probs.items():
                            change_bps = int(change_str)
                            # Fed rates are typically in 25bp increments
                            # Calculate the target rate range
                            target_rate_lower = current_rate_bps + change_bps - 12.5
                            target_rate_upper = current_rate_bps + change_bps + 12.5
                            
                            # Round to nearest 25bp boundaries
                            target_rate_lower = round(target_rate_lower / 25) * 25
                            target_rate_upper = round(target_rate_upper / 25) * 25
                            
                            # Format as range string
                            range_key = f"{int(target_rate_lower)}-{int(target_rate_upper)}"
                            target_rate_probs[range_key] = prob
                        
                        # Sort by target rate (ascending)
                        sorted_target_rates = dict(sorted(target_rate_probs.items(), key=lambda x: int(x[0].split('-')[0])))
                        
                        most_likely = max(sorted_target_rates.items(), key=lambda x: x[1])
                        
                        # Calculate next FOMC meeting (rough estimate)
                        today = datetime.now()
                        next_meeting = today + timedelta(days=30)
                        
                        return {
                            "next_meeting_date": next_meeting.strftime("%B %d, %Y"),
                            "probabilities": change_probs,
                            "target_rate_probabilities": {k: round(v * 100, 2) for k, v in sorted_target_rates.items()},
                            "most_likely_change": most_likely[0],
                            "most_likely_probability": round(most_likely[1] * 100, 2),
                            "all_probabilities": {k: round(v * 100, 2) for k, v in change_probs.items()},
                            "source": "Calculated from Market Rates",
                            "current_fed_rate": round(current_rate, 2),
                            "current_target_rate": f"{int(current_rate_bps - 12.5)}-{int(current_rate_bps + 12.5)}"
                        }
            except Exception as e:
                print(f"Error calculating from rates: {e}")
    except Exception as e:
        print(f"Error in rate calculation: {e}")
    
    return None

def fetch_fedwatch_fallback():
    """Fallback: Return estimated probabilities based on general market conditions"""
    from datetime import datetime, timedelta
    
    # Calculate next FOMC meeting date
    today = datetime.now()
    next_meeting = today + timedelta(days=30)
    
    # Get current rates to inform probabilities
    try:
        # Try to get current Fed Funds rate for better estimates
        if FRED_API_KEY != "YOUR_API_KEY_HERE":
            try:
                current_rate_df = web.DataReader('DFF', 'fred', datetime.now() - timedelta(days=5), datetime.now(), api_key=FRED_API_KEY)
                if not current_rate_df.empty:
                    current_rate = float(current_rate_df.iloc[-1]['DFF'])
                    current_rate_bps = current_rate * 100
                    
                    # Simple heuristic: if rate is high (>4%), more likely to cut; if low (<3%), more likely to hike
                    if current_rate > 4.5:
                        change_probs = {"-25": 0.6, "0": 0.3, "25": 0.1}
                    elif current_rate < 3.0:
                        change_probs = {"-25": 0.1, "0": 0.3, "25": 0.6}
                    else:
                        change_probs = {"-25": 0.3, "0": 0.4, "25": 0.3}
                    
                    # Convert to target rate ranges
                    target_rate_probs = {}
                    for change_str, prob in change_probs.items():
                        change_bps = int(change_str)
                        target_rate_lower = current_rate_bps + change_bps - 12.5
                        target_rate_upper = current_rate_bps + change_bps + 12.5
                        target_rate_lower = round(target_rate_lower / 25) * 25
                        target_rate_upper = round(target_rate_upper / 25) * 25
                        range_key = f"{int(target_rate_lower)}-{int(target_rate_upper)}"
                        target_rate_probs[range_key] = prob
                    
                    sorted_target_rates = dict(sorted(target_rate_probs.items(), key=lambda x: int(x[0].split('-')[0])))
                    most_likely = max(sorted_target_rates.items(), key=lambda x: x[1])
                    
                    return {
                        "next_meeting_date": next_meeting.strftime("%B %d, %Y"),
                        "probabilities": change_probs,
                        "target_rate_probabilities": {k: round(v * 100, 2) for k, v in sorted_target_rates.items()},
                        "most_likely_change": most_likely[0],
                        "most_likely_probability": round(most_likely[1] * 100, 2),
                        "all_probabilities": {k: round(v * 100, 2) for k, v in change_probs.items()},
                        "source": "Estimated from Current Rates",
                        "current_fed_rate": round(current_rate, 2),
                        "current_target_rate": f"{int(current_rate_bps - 12.5)}-{int(current_rate_bps + 12.5)}",
                        "note": "Probabilities estimated from current Fed Funds rate. For precise probabilities, visit: https://www.atlantafed.org/cenfis/market-probability-tracker"
                    }
            except:
                pass
    except:
        pass
    
    # Final fallback with neutral probabilities
    # Assume current rate around 4.0% (400 bps) for fallback
    current_rate_bps = 400
    change_probs = {"-25": 0.35, "0": 0.4, "25": 0.25}
    
    # Convert to target rate ranges
    target_rate_probs = {}
    for change_str, prob in change_probs.items():
        change_bps = int(change_str)
        target_rate_lower = current_rate_bps + change_bps - 12.5
        target_rate_upper = current_rate_bps + change_bps + 12.5
        target_rate_lower = round(target_rate_lower / 25) * 25
        target_rate_upper = round(target_rate_upper / 25) * 25
        range_key = f"{int(target_rate_lower)}-{int(target_rate_upper)}"
        target_rate_probs[range_key] = prob
    
    sorted_target_rates = dict(sorted(target_rate_probs.items(), key=lambda x: int(x[0].split('-')[0])))
    most_likely = max(sorted_target_rates.items(), key=lambda x: x[1])
    
    return {
        "next_meeting_date": next_meeting.strftime("%B %d, %Y"),
        "probabilities": change_probs,
        "target_rate_probabilities": {k: round(v * 100, 2) for k, v in sorted_target_rates.items()},
        "most_likely_change": most_likely[0],
        "most_likely_probability": round(most_likely[1] * 100, 2),
        "all_probabilities": {k: round(v * 100, 2) for k, v in change_probs.items()},
        "source": "Estimated Probabilities",
        "current_target_rate": f"{int(current_rate_bps - 12.5)}-{int(current_rate_bps + 12.5)}",
        "note": "Using estimated probabilities. For real-time data, visit: https://www.atlantafed.org/cenfis/market-probability-tracker"
    }

@app.route('/api/fedwatch')
def fedwatch_data():
    # For FedWatch, always fetch fresh data (it's just hardcoded, very fast)
    # This ensures we always have the latest data
    response_data = fetch_fedwatch_data()
    
    # Check memory cache first (for fast repeated requests)
    cached = get_cached_data('fedwatch')
    if cached and not compare_data(cached, response_data):
        # If memory cache matches, return it
        return jsonify(cached)
    
    # Update cache with fresh data
    save_to_cache('fedwatch', response_data, data_changed=False)
    set_cached_data('fedwatch', response_data)
    
    return jsonify(response_data)

# --- MANUAL UPDATE ENDPOINT (for testing/admin) ---
@app.route('/api/update-cache')
def manual_update_cache():
    """Manually trigger cache update for all data types"""
    results = {}
    
    # Update macro data
    try:
        print("Manual update: Fetching macro data...")
        data = fetch_macro_data()
        if 'error' not in data:
            save_to_cache('macro', data, data_changed=True)
            set_cached_data('macro', data)
            results['macro'] = {'status': 'success', 'message': 'Macro data updated'}
        else:
            results['macro'] = {'status': 'error', 'message': data.get('error', 'Unknown error')}
    except Exception as e:
        results['macro'] = {'status': 'error', 'message': str(e)}
    
    # Update rates data
    try:
        print("Manual update: Fetching rates data...")
        data = fetch_rates_data()
        if 'error' not in data:
            save_to_cache('rates', data, data_changed=True)
            set_cached_data('rates', data)
            results['rates'] = {'status': 'success', 'message': 'Rates data updated'}
        else:
            results['rates'] = {'status': 'error', 'message': data.get('error', 'Unknown error')}
    except Exception as e:
        results['rates'] = {'status': 'error', 'message': str(e)}
    
    # Update fedwatch data
    try:
        print("Manual update: Fetching fedwatch data...")
        data = fetch_fedwatch_data()
        if 'error' not in data:
            save_to_cache('fedwatch', data, data_changed=True)
            set_cached_data('fedwatch', data)
            results['fedwatch'] = {'status': 'success', 'message': 'Fedwatch data updated'}
        else:
            results['fedwatch'] = {'status': 'error', 'message': data.get('error', 'Unknown error')}
    except Exception as e:
        results['fedwatch'] = {'status': 'error', 'message': str(e)}
    
    return jsonify({
        'message': 'Cache update completed',
        'results': results,
        'timestamp': datetime.now().isoformat()
    })

@app.route('/api/cache-status')
def cache_status():
    """Get status of all caches"""
    status = {}
    for data_type in ['macro', 'rates', 'fedwatch']:
        is_valid = is_cache_valid(data_type)
        cache_age = get_cache_age(data_type)
        status[data_type] = {
            'valid': is_valid,
            'age_days': cache_age if cache_age is not None else 'N/A',
            'needs_update': not is_valid if cache_age is not None else True
        }
    return jsonify({
        'cache_status': status,
        'update_interval_days': 3,
        'timestamp': datetime.now().isoformat(),
        'fred_api_key_set': FRED_API_KEY != "YOUR_API_KEY_HERE"
    })

@app.route('/api/clear-cache')
def clear_cache_endpoint():
    """Clear all caches - forces fresh data fetch on next request"""
    from cache_manager import clear_cache
    try:
        clear_cache()  # Clear all caches
        return jsonify({
            'message': 'All caches cleared successfully. Next API call will fetch fresh data.',
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }), 500

# --- SERVE FRONTEND ---
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    # Don't serve API routes as static files
    if path.startswith('api/'):
        return jsonify({"error": "API endpoint not found"}), 404
    
    # Check if file exists
    file_path = os.path.join(app.static_folder, path) if path else os.path.join(app.static_folder, 'index.html')
    if path and os.path.exists(file_path) and os.path.isfile(file_path):
        return send_from_directory(app.static_folder, path)
    else:
        # Serve index.html for SPA routing
        index_path = os.path.join(app.static_folder, 'index.html')
        if os.path.exists(index_path):
            return send_from_directory(app.static_folder, 'index.html')
        else:
            return jsonify({"error": "Frontend not found. Please deploy frontend separately."}), 404

def prewarm_cache():
    """Pre-warm cache on server start - load from CSV if valid, otherwise fetch fresh"""
    print("Pre-warming cache...")
    
    # Check and load macro data
    if is_cache_valid('macro'):
        data = load_from_cache('macro')
        if data:
            set_cached_data('macro', data)
            cache_age = get_cache_age('macro')
            print(f"Loaded macro data from cache (age: {cache_age} days)")
        else:
            print("Macro cache exists but couldn't load, fetching fresh...")
            data = fetch_macro_data()
            if 'error' not in data:
                save_to_cache('macro', data, data_changed=False)
                set_cached_data('macro', data)
    else:
        print("Macro cache invalid or missing, fetching fresh data...")
        data = fetch_macro_data()
        if 'error' not in data:
            save_to_cache('macro', data, data_changed=False)
            set_cached_data('macro', data)
    
    # Check and load rates data
    if is_cache_valid('rates'):
        data = load_from_cache('rates')
        if data:
            set_cached_data('rates', data)
            cache_age = get_cache_age('rates')
            print(f"Loaded rates data from cache (age: {cache_age} days)")
        else:
            print("Rates cache exists but couldn't load, fetching fresh...")
            data = fetch_rates_data()
            if 'error' not in data:
                save_to_cache('rates', data, data_changed=False)
                set_cached_data('rates', data)
    else:
        print("Rates cache invalid or missing, fetching fresh data...")
        data = fetch_rates_data()
        if 'error' not in data:
            save_to_cache('rates', data, data_changed=False)
            set_cached_data('rates', data)
    
    # Check and load fedwatch data
    if is_cache_valid('fedwatch'):
        data = load_from_cache('fedwatch')
        if data:
            set_cached_data('fedwatch', data)
            cache_age = get_cache_age('fedwatch')
            print(f"Loaded fedwatch data from cache (age: {cache_age} days)")
        else:
            print("Fedwatch cache exists but couldn't load, fetching fresh...")
            data = fetch_fedwatch_data()
            if 'error' not in data:
                save_to_cache('fedwatch', data, data_changed=False)
                set_cached_data('fedwatch', data)
    else:
        print("Fedwatch cache invalid or missing, fetching fresh data...")
        data = fetch_fedwatch_data()
        if 'error' not in data:
            save_to_cache('fedwatch', data, data_changed=False)
            set_cached_data('fedwatch', data)
    
    print("Cache pre-warmed successfully")

def update_data_worker():
    """Background worker that checks and updates data when it's older than 3 days"""
    # Wait a bit before starting to let server initialize
    time.sleep(60)  # Wait 1 minute after server start
    
    while True:
        try:
            print("\n=== Checking if data needs updating ===")
            updated_any = False
            
            # Check and update macro data if needed
            if not is_cache_valid('macro'):
                cache_age = get_cache_age('macro')
                age_msg = f"{cache_age} days old" if cache_age is not None else "missing"
                print(f"Macro data is {age_msg} (threshold: 3 days), updating...")
                data = fetch_macro_data()
                if 'error' not in data:
                    save_to_cache('macro', data, data_changed=True)
                    set_cached_data('macro', data)
                    print("Macro data updated successfully")
                    updated_any = True
                else:
                    print(f"Error updating macro data: {data.get('error')}")
            else:
                cache_age = get_cache_age('macro')
                if cache_age is not None:
                    print(f"Macro data is fresh (age: {cache_age} days)")
                else:
                    print("Macro data is fresh")
            
            # Check and update rates data if needed
            if not is_cache_valid('rates'):
                cache_age = get_cache_age('rates')
                age_msg = f"{cache_age} days old" if cache_age is not None else "missing"
                print(f"Rates data is {age_msg} (threshold: 3 days), updating...")
                data = fetch_rates_data()
                if 'error' not in data:
                    save_to_cache('rates', data, data_changed=True)
                    set_cached_data('rates', data)
                    print("Rates data updated successfully")
                    updated_any = True
                else:
                    print(f"Error updating rates data: {data.get('error')}")
            else:
                cache_age = get_cache_age('rates')
                if cache_age is not None:
                    print(f"Rates data is fresh (age: {cache_age} days)")
                else:
                    print("Rates data is fresh")
            
            # Check and update fedwatch data if needed
            if not is_cache_valid('fedwatch'):
                cache_age = get_cache_age('fedwatch')
                age_msg = f"{cache_age} days old" if cache_age is not None else "missing"
                print(f"Fedwatch data is {age_msg} (threshold: 3 days), updating...")
                data = fetch_fedwatch_data()
                if 'error' not in data:
                    save_to_cache('fedwatch', data, data_changed=True)
                    set_cached_data('fedwatch', data)
                    print("Fedwatch data updated successfully")
                    updated_any = True
                else:
                    print(f"Error updating fedwatch data: {data.get('error')}")
            else:
                cache_age = get_cache_age('fedwatch')
                if cache_age is not None:
                    print(f"Fedwatch data is fresh (age: {cache_age} days)")
                else:
                    print("Fedwatch data is fresh")
            
            if updated_any:
                print("=== Background data update completed ===\n")
            else:
                print("=== All data is up to date ===\n")
            
            # Check every 12 hours (in case data needs updating)
            time.sleep(43200)  # 12 hours
            
        except Exception as e:
            print(f"Error in background update worker: {e}")
            import traceback
            traceback.print_exc()
            # Sleep for 1 hour before retrying if there's an error
            time.sleep(3600)

if __name__ == '__main__':
    # Pre-warm cache BEFORE starting server to ensure first request is fast
    # Run in background but don't start server until cache is at least partially ready
    print("Pre-warming cache before server start...")
    prewarm_thread = threading.Thread(target=prewarm_cache, daemon=True)
    prewarm_thread.start()
    
    # Give cache a few seconds to start loading (non-blocking for server start)
    # But this ensures cache starts loading immediately
    time.sleep(2)  # Allow 2 seconds for cache to start loading
    
    # Start background worker to update data every 7 days
    update_thread = threading.Thread(target=update_data_worker, daemon=True)
    update_thread.start()
    print("Background data update worker started (will update every 7 days)")
    
    port = int(os.environ.get('PORT', 5001))
    app.run(debug=True, host='0.0.0.0', port=port)