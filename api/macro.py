"""Vercel serverless function for macro data"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys

# Fix for Python 3.12+ where distutils was removed
try:
    import distutils
except ImportError:
    try:
        import setuptools
        sys.modules['distutils'] = setuptools
        sys.modules['distutils.util'] = setuptools.util
        sys.modules['distutils.version'] = setuptools.version
    except ImportError:
        class DistutilsStub:
            class util:
                @staticmethod
                def strtobool(val):
                    val = val.lower()
                    if val in ('y', 'yes', 't', 'true', 'on', '1'):
                        return 1
                    elif val in ('n', 'no', 'f', 'false', 'off', '0'):
                        return 0
                    else:
                        raise ValueError(f"invalid truth value {val!r}")
            class version:
                class LooseVersion:
                    def __init__(self, v):
                        self.v = v
                    def __str__(self):
                        return str(self.v)
        sys.modules['distutils'] = DistutilsStub()
        sys.modules['distutils.util'] = DistutilsStub.util
        sys.modules['distutils.version'] = DistutilsStub.version

# Lazy imports to avoid failures at module load time
_datetime = None
_timedelta = None
_ThreadPoolExecutor = None
_as_completed = None
_web = None
_pd = None

def _import_dependencies():
    """Lazy import of dependencies"""
    global _datetime, _timedelta, _ThreadPoolExecutor, _as_completed, _web, _pd
    if _datetime is not None:
        return
    
    try:
        from datetime import datetime as _datetime, timedelta as _timedelta
        from concurrent.futures import ThreadPoolExecutor as _ThreadPoolExecutor, as_completed as _as_completed
        import pandas_datareader.data as _web
        import pandas as _pd
    except ImportError as e:
        print(f"Failed to import dependencies: {e}")
        raise

# Add api directory to path for imports
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

# Get API Key from environment variable (lazy - no execution)
def _get_fred_api_key():
    return os.getenv("FRED_API_KEY", "YOUR_API_KEY_HERE")

def fetch_macro_data():
    """Fetch macro data from FRED - optimized with parallel fetching"""
    try:
        # Import dependencies lazily
        _import_dependencies()
        
        series_map = {
            "CPI": "CPIAUCSL",
            "PCE Headline": "PCEPI",
            "PCE Core": "PCECTPI",
            "PPI": "PPIACO",
            "PMI": "NAPM",
            "Non-Farm Payrolls": "PAYEMS",
            "Unemployment Rate": "UNRATE",
            "Unemployment Claims": "ICSA",
            "JOLTS": "JTSJOL",
            "Consumer Sentiment": "UMCSENT",
            "Consumer Confidence": "CONCCONF",
        }
        
        pmi_alternatives = ["MANPMI", "UMCSENT"]
        response_data = {}
        FRED_API_KEY = _get_fred_api_key()
        start_date = _datetime.now() - _timedelta(days=550)  # ~18 months
        
        if FRED_API_KEY == "YOUR_API_KEY_HERE":
            # Return empty data instead of error - macro data requires FRED API key
            # FRED is free but requires registration at https://fred.stlouisfed.org/docs/api/api_key.html
            return {}

        def fetch_series(name, series_id):
            """Helper function to fetch a single series"""
            try:
                end_date = _datetime.now() + _timedelta(days=60)
                
                if name == "PMI":
                    df = None
                    for alt_id in [series_id] + pmi_alternatives:
                        try:
                            df = _web.DataReader(alt_id, 'fred', start_date, end_date, api_key=FRED_API_KEY)
                            df = df.reset_index()
                            series_id = alt_id
                            break
                        except:
                            continue
                    if df is None or len(df) == 0:
                        return None
                else:
                    df = _web.DataReader(series_id, 'fred', start_date, end_date, api_key=FRED_API_KEY)
                    df = df.reset_index()
                
                df = df.dropna(subset=[series_id])
                if len(df) == 0:
                    return None
                
                df = df.sort_values('DATE')
                df = df.drop_duplicates(subset='DATE', keep='last')
                df['date'] = df['DATE'].dt.strftime('%Y-%m-%d')
                df['pct_change'] = df[series_id].pct_change() * 100
                df['pct_change'] = df['pct_change'].fillna(0)
                
                latest = float(df[series_id].iloc[-1])
                latest_date = df['date'].iloc[-1]
                prev = float(df[series_id].iloc[-2]) if len(df) > 1 else latest
                change = ((latest - prev) / prev) * 100 if prev != 0 else 0
                
                # Calculate YoY change
                yoy_change = None
                if name in ["CPI", "PCE Headline", "PCE Core", "PPI", "Non-Farm Payrolls", "JOLTS"]:
                    try:
                        latest_date_obj = _pd.to_datetime(latest_date)
                        one_year_ago = latest_date_obj - _pd.DateOffset(years=1)
                        df['DATE_dt'] = _pd.to_datetime(df['DATE'])
                        one_year_data = df[df['DATE_dt'] <= one_year_ago]
                        if len(one_year_data) > 0:
                            one_year_value = float(one_year_data.iloc[-1][series_id])
                            yoy_change = ((latest - one_year_value) / one_year_value) * 100 if one_year_value != 0 else 0
                    except Exception as e:
                        print(f"Error calculating YoY change for {name}: {e}")
                
                history_data = df[['date', series_id, 'pct_change']].copy()
                history_data[series_id] = history_data[series_id].astype(float)
                history_data['pct_change'] = history_data['pct_change'].astype(float).round(2)
                history_data = history_data.rename(columns={series_id: 'value'})
                
                result_data = {
                    "history": history_data.to_dict(orient='records'),
                    "current": latest,
                    "latest_date": latest_date,
                    "change": round(change, 2)
                }
                
                if yoy_change is not None:
                    result_data["yoy_change"] = round(yoy_change, 2)
                
                return {'name': name, 'data': result_data}
            except Exception as e:
                print(f"Error fetching {name} ({series_id}): {str(e)}")
                return None
    
        try:
            # Fetch all series in parallel
            with _ThreadPoolExecutor(max_workers=8) as executor:
                futures = {executor.submit(fetch_series, name, series_id): name 
                          for name, series_id in series_map.items()}
                
                for future in _as_completed(futures):
                    try:
                        result = future.result()
                        if result:
                            response_data[result['name']] = result['data']
                    except Exception as e:
                        print(f"Error getting result from future: {e}")
                        continue
        except Exception as e:
            import traceback
            print(f"Error in fetch_macro_data: {e}")
            traceback.print_exc()
            return {"error": f"Failed to fetch macro data: {str(e)}"}
        
        return response_data
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback_str = traceback.format_exc()
        print(f"Error in fetch_macro_data (outer): {error_msg}")
        print(traceback_str)
        return {"error": f"Failed to fetch macro data: {error_msg}"}

class handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        """Override to prevent logging errors"""
        pass
    
    def do_GET(self):
        try:
            # Fetch fresh data (no caching in serverless - Vercel handles it at CDN level)
            data = fetch_macro_data()
            
            # Check if data is empty (no FRED API key) or has error
            if not data or 'error' in data:
                # Return 200 with empty data or error message (not 500)
                # Frontend can handle empty data gracefully
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                if 'error' in data:
                    self.wfile.write(json.dumps(data).encode('utf-8'))
                else:
                    # Return empty object if no data (FRED API key missing)
                    self.wfile.write(json.dumps({}).encode('utf-8'))
                return
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            response_data = json.dumps(data).encode('utf-8')
            self.wfile.write(response_data)
        except Exception as e:
            import traceback
            error_msg = str(e)
            traceback_str = traceback.format_exc()
            print(f"Error in /api/macro handler: {error_msg}")
            print(traceback_str)
            try:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                error_response = json.dumps({"error": error_msg, "traceback": traceback_str}).encode('utf-8')
                self.wfile.write(error_response)
            except:
                # If we can't send response, just log it
                print("Failed to send error response")
    
    def do_OPTIONS(self):
        try:
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.end_headers()
        except:
            pass
        return
