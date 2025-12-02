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

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__, static_folder='../Frontend/frontend/dist', static_url_path='/')
CORS(app)  # Allow React to talk to Flask in dev

# --- CONFIGURATION ---
# Get API Key from environment variable (loads from .env file or system env)
FRED_API_KEY = os.getenv("FRED_API_KEY", "YOUR_API_KEY_HERE")

# --- CACHING ---
# Cache data for 5 minutes to reduce API calls
CACHE_DURATION = timedelta(minutes=5)
cache = {
    'macro': {'data': None, 'timestamp': None},
    'rates': {'data': None, 'timestamp': None},
    'fedwatch': {'data': None, 'timestamp': None}
}
cache_lock = threading.Lock()

def get_cached_data(key):
    """Get cached data if it's still valid"""
    with cache_lock:
        cached = cache.get(key)
        if cached and cached['data'] and cached['timestamp']:
            age = datetime.now() - cached['timestamp']
            if age < CACHE_DURATION:
                return cached['data']
    return None

def set_cached_data(key, data):
    """Store data in cache"""
    with cache_lock:
        cache[key] = {'data': data, 'timestamp': datetime.now()} 

# --- HELPER FUNCTIONS ---
def get_yield_curve():
    # Tickers: 13W, 5Y, 10Y, 30Y
    tickers = {'13W': '^IRX', '2Y': '^IRX', '5Y': '^FVX', '10Y': '^TNX', '30Y': '^TYX'}
    data = {}
    try:
        for label, ticker in tickers.items():
            tick = yf.Ticker(ticker)
            hist = tick.history(period="1d")
            if not hist.empty:
                # Yahoo yields are prices (e.g., 4.5), we keep them as is for display
                data[label] = hist['Close'].iloc[-1]
    except Exception as e:
        print(f"Error fetching yields: {e}")
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
    """Fetch macro data from FRED (used for caching)"""
    # Series IDs: CPI, PPI, Non-Farm Payrolls, PMI, Unemployment Claims
    # Note: PMI - trying alternative series IDs if one doesn't work
    series_map = {
        "CPI": "CPIAUCSL", 
        "PPI": "PPIACO", 
        "Payrolls": "PAYEMS",
        "PMI": "NAPM",  # ISM Manufacturing PMI - will try alternative if this fails
        "Unemployment Claims": "ICSA"  # Initial Claims, Seasonally Adjusted
    }
    
    # Alternative PMI series IDs to try if primary fails
    pmi_alternatives = ["MANPMI", "UMCSENT"]  # Manufacturing PMI alternatives
    
    response_data = {}
    start_date = datetime(2022, 1, 1)
    
    if FRED_API_KEY == "YOUR_API_KEY_HERE":
        return {"error": "Missing FRED API Key"}

    try:
        # Get data up to today + 1 month to ensure we capture the latest available data
        # FRED data is typically released mid-month for the previous month
        end_date = datetime.now() + timedelta(days=60)  # Look ahead to catch latest releases
        
        for name, series_id in series_map.items():
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
                        continue
                else:
                    # Fetch data from FRED - pandas_datareader will get the latest available data
                    df = web.DataReader(series_id, 'fred', start_date, end_date, api_key=FRED_API_KEY)
                    df = df.reset_index()
                
                # Drop any NaN values that might be at the end (future dates without data yet)
                df = df.dropna(subset=[series_id])
                
                if len(df) == 0:
                    print(f"Warning: No data found for {name} ({series_id})")
                    continue
                
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
                
                # Convert to native Python types for JSON serialization
                history_data = df[['date', series_id, 'pct_change']].copy()
                history_data[series_id] = history_data[series_id].astype(float)
                history_data['pct_change'] = history_data['pct_change'].astype(float).round(2)
                
                # Rename the series_id column to 'value' for easier frontend access
                history_data = history_data.rename(columns={series_id: 'value'})
                
                response_data[name] = {
                    "history": history_data.to_dict(orient='records'),
                    "current": latest,
                    "latest_date": latest_date,
                    "change": round(change, 2)
                }
            except Exception as e:
                print(f"Error fetching {name} ({series_id}): {str(e)}")
                # Skip this series if it fails, continue with others
                continue
    except Exception as e:
        return {"error": str(e)}
        
    return response_data

@app.route('/api/macro')
def macro_data():
    # Check cache first
    cached = get_cached_data('macro')
    if cached:
        return jsonify(cached)
    
    # Fetch fresh data
    response_data = fetch_macro_data()
    
    # Cache the result
    if 'error' not in response_data:
        set_cached_data('macro', response_data)
    
    return jsonify(response_data)

def fetch_rates_data():
    """Fetch rates data (used for caching)"""
    yields = get_yield_curve()
    
    if not yields:
        return {"error": "Failed to fetch yields"}

    # 1. Curve Shape Analysis (2s10s and 5s30s)
    spread_2s10s = yields.get('10Y', 0) - yields.get('13W', 0) # Using 13W as proxy for short if 2Y fails
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
    # Check cache first
    cached = get_cached_data('rates')
    if cached:
        return jsonify(cached)
    
    # Fetch fresh data
    response_data = fetch_rates_data()
    
    # Cache the result
    if 'error' not in response_data:
        set_cached_data('rates', response_data)
    
    return jsonify(response_data)

def fetch_fedwatch_data():
    """Fetch FedWatch interest rate cut odds using FREE sources
    
    This function tries multiple free sources:
    1. Federal Reserve Bank of Atlanta Market Probability Tracker
    2. Calculated probabilities based on current Fed Funds rate
    3. Falls back to estimated probabilities if other sources fail
    """
    # Try Atlanta Fed Market Probability Tracker first
    try:
        atlanta_fed_data = fetch_atlanta_fed_probabilities()
        if atlanta_fed_data and not atlanta_fed_data.get('error'):
            return atlanta_fed_data
    except Exception as e:
        print(f"Atlanta Fed source failed: {e}")
    
    # Try calculating from current rates
    try:
        calculated_data = calculate_fed_probabilities_from_rates()
        if calculated_data and not calculated_data.get('error'):
            return calculated_data
    except Exception as e:
        print(f"Rate calculation failed: {e}")
    
    # Final fallback
    return fetch_fedwatch_fallback()

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
            probabilities = {}
            for item in data.get('probabilities', []):
                rate_change = item.get('rateChange', 0)
                prob = item.get('probability', 0)
                probabilities[str(int(rate_change))] = prob
            
            if probabilities:
                most_likely = max(probabilities.items(), key=lambda x: x[1])
                return {
                    "next_meeting_date": data.get('meetingDate', 'N/A'),
                    "probabilities": probabilities,
                    "most_likely_change": most_likely[0],
                    "most_likely_probability": round(most_likely[1] * 100, 2),
                    "all_probabilities": {k: round(v * 100, 2) for k, v in probabilities.items()},
                    "source": "Atlanta Fed Market Probability Tracker"
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
                        probabilities = {}
                        
                        if spread > 0.15:  # Market expects cuts (yield below Fed Funds)
                            cut_prob = min(0.75, 0.4 + spread * 1.5)
                            hike_prob = max(0.05, 0.3 - spread * 1.0)
                            no_change_prob = 1.0 - cut_prob - hike_prob
                            probabilities["-25"] = max(0.1, cut_prob)
                            probabilities["0"] = max(0.1, no_change_prob)
                            probabilities["25"] = max(0.05, hike_prob)
                        elif spread < -0.15:  # Market expects hikes (yield above Fed Funds)
                            hike_prob = min(0.75, 0.4 + abs(spread) * 1.5)
                            cut_prob = max(0.05, 0.3 - abs(spread) * 1.0)
                            no_change_prob = 1.0 - cut_prob - hike_prob
                            probabilities["-25"] = max(0.05, cut_prob)
                            probabilities["0"] = max(0.1, no_change_prob)
                            probabilities["25"] = max(0.1, hike_prob)
                        else:  # Neutral
                            probabilities["-25"] = 0.3
                            probabilities["0"] = 0.5
                            probabilities["25"] = 0.2
                        
                        # Normalize probabilities
                        total = sum(probabilities.values())
                        probabilities = {k: v/total for k, v in probabilities.items()}
                        
                        most_likely = max(probabilities.items(), key=lambda x: x[1])
                        
                        # Calculate next FOMC meeting (rough estimate)
                        today = datetime.now()
                        next_meeting = today + timedelta(days=30)
                        
                        return {
                            "next_meeting_date": next_meeting.strftime("%B %d, %Y"),
                            "probabilities": probabilities,
                            "most_likely_change": most_likely[0],
                            "most_likely_probability": round(most_likely[1] * 100, 2),
                            "all_probabilities": {k: round(v * 100, 2) for k, v in probabilities.items()},
                            "source": "Calculated from Market Rates",
                            "current_fed_rate": round(current_rate, 2)
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
                    
                    # Simple heuristic: if rate is high (>4%), more likely to cut; if low (<3%), more likely to hike
                    if current_rate > 4.5:
                        probabilities = {"-25": 0.6, "0": 0.3, "25": 0.1}
                    elif current_rate < 3.0:
                        probabilities = {"-25": 0.1, "0": 0.3, "25": 0.6}
                    else:
                        probabilities = {"-25": 0.3, "0": 0.4, "25": 0.3}
                    
                    most_likely = max(probabilities.items(), key=lambda x: x[1])
                    
                    return {
                        "next_meeting_date": next_meeting.strftime("%B %d, %Y"),
                        "probabilities": probabilities,
                        "most_likely_change": most_likely[0],
                        "most_likely_probability": round(most_likely[1] * 100, 2),
                        "all_probabilities": {k: round(v * 100, 2) for k, v in probabilities.items()},
                        "source": "Estimated from Current Rates",
                        "current_fed_rate": round(current_rate, 2),
                        "note": "Probabilities estimated from current Fed Funds rate. For precise probabilities, visit: https://www.atlantafed.org/cenfis/market-probability-tracker"
                    }
            except:
                pass
    except:
        pass
    
    # Final fallback with neutral probabilities
    probabilities = {"-25": 0.35, "0": 0.4, "25": 0.25}
    most_likely = max(probabilities.items(), key=lambda x: x[1])
    
    return {
        "next_meeting_date": next_meeting.strftime("%B %d, %Y"),
        "probabilities": probabilities,
        "most_likely_change": most_likely[0],
        "most_likely_probability": round(most_likely[1] * 100, 2),
        "all_probabilities": {k: round(v * 100, 2) for k, v in probabilities.items()},
        "source": "Estimated Probabilities",
        "note": "Using estimated probabilities. For real-time data, visit: https://www.atlantafed.org/cenfis/market-probability-tracker"
    }

@app.route('/api/fedwatch')
def fedwatch_data():
    # Check cache first
    cached = get_cached_data('fedwatch')
    if cached:
        return jsonify(cached)
    
    # Fetch fresh data
    response_data = fetch_fedwatch_data()
    
    # Cache the result
    if 'error' not in response_data:
        set_cached_data('fedwatch', response_data)
    
    return jsonify(response_data)

# --- SERVE FRONTEND ---
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path != "" and os.path.exists(app.static_folder + '/' + path):
        return send_from_directory(app.static_folder, path)
    else:
        return send_from_directory(app.static_folder, 'index.html')

def prewarm_cache():
    """Pre-warm cache on server start"""
    print("Pre-warming cache...")
    try:
        fetch_macro_data()
        fetch_rates_data()
        fetch_fedwatch_data()
        print("Cache pre-warmed successfully")
    except Exception as e:
        print(f"Error pre-warming cache: {e}")

if __name__ == '__main__':
    # Pre-warm cache in background thread
    threading.Thread(target=prewarm_cache, daemon=True).start()
    app.run(debug=True, port=5001)