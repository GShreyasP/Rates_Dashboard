"""Shared utilities for Vercel serverless functions"""
import os
import sys

# Fix for Python 3.12+ where distutils was removed
# Provide distutils compatibility before importing packages that need it
try:
    import distutils
except ImportError:
    # Python 3.12+ - distutils was removed, use setuptools as replacement
    try:
        import setuptools
        # Create a distutils module alias
        sys.modules['distutils'] = setuptools
        sys.modules['distutils.util'] = setuptools.util
        sys.modules['distutils.version'] = setuptools.version
    except ImportError:
        # If setuptools is not available, create a minimal distutils stub
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

from datetime import datetime, timedelta
import pandas_datareader.data as web
import yfinance as yf
import pandas as pd

# Get API Key from environment variable
FRED_API_KEY = os.getenv("FRED_API_KEY", "YOUR_API_KEY_HERE")

def get_yield_curve():
    """Fetch yield curve data from multiple sources"""
    data = {}
    
    try:
        # FRED API Treasury constant maturity rates (PRIMARY SOURCE)
        # Fetching all requested maturities: 1,3,6 mo and 1,3,5,7,20,30 yr
        # Note: 13M doesn't exist in FRED, removed it
        fred_series = {
            '1M': 'DGS1MO',   # 1-month
            '3M': 'DGS3MO',   # 3-month
            '6M': 'DGS6MO',   # 6-month
            '1Y': 'DGS1',    # 1-year
            '3Y': 'DGS3',    # 3-year
            '5Y': 'DGS5',    # 5-year
            '7Y': 'DGS7',    # 7-year
            '10Y': 'DGS10',  # 10-year
            '20Y': 'DGS20',  # 20-year
            '30Y': 'DGS30'   # 30-year
        }
        
        # Check if FRED API key is set
        api_key_set = FRED_API_KEY and FRED_API_KEY != "YOUR_API_KEY_HERE" and len(FRED_API_KEY) > 10
        print(f"FRED_API_KEY check: {'SET' if api_key_set else 'NOT SET'} (length: {len(FRED_API_KEY) if FRED_API_KEY else 0})")
        
        # Fetch from FRED first (primary source)
        if api_key_set:
            try:
                # Use today's date (not future dates)
                end_date = datetime.now().date()
                start_date = end_date - timedelta(days=30)  # Look back 30 days to ensure we get data
                print(f"Fetching FRED data from {start_date} to {end_date}")
                
                for label, series_id in fred_series.items():
                    try:
                        df = web.DataReader(series_id, 'fred', start_date, end_date, api_key=FRED_API_KEY)
                        if not df.empty:
                            series_data = df[series_id].dropna()
                            if len(series_data) > 0:
                                data[label] = float(series_data.iloc[-1])
                                print(f"✓ Successfully fetched {label} ({series_id}) from FRED: {data[label]}")
                            else:
                                print(f"✗ No valid data for {label} ({series_id}) - empty after dropna")
                        else:
                            print(f"✗ Empty dataframe for {label} ({series_id})")
                    except Exception as e:
                        print(f"✗ Error fetching {label} ({series_id}) from FRED: {str(e)}")
            except Exception as e:
                print(f"✗ Error in FRED fetch loop: {str(e)}")
                import traceback
                traceback.print_exc()
        else:
            print("⚠ Warning: FRED_API_KEY not properly set, will use yfinance as fallback")
        
        # Yahoo Finance tickers (as backup for maturities not available from FRED)
        yf_tickers = {
            '5Y': '^FVX',   # 5-year Treasury Note
            '10Y': '^TNX',  # 10-year Treasury Note
            '30Y': '^TYX'   # 30-year Treasury Bond
        }
        
        # Fetch from yfinance only for maturities not already fetched from FRED
        try:
            for label, ticker in yf_tickers.items():
                # Only use yfinance if FRED data is not available
                if label not in data:
                    try:
                        tick = yf.Ticker(ticker)
                        hist = tick.history(period="1d")
                        if not hist.empty:
                            data[label] = float(hist['Close'].iloc[-1])
                            print(f"Fetched {label} from yfinance (FRED unavailable): {data[label]}")
                    except Exception as e:
                        print(f"Error fetching {label} ({ticker}) from yfinance: {e}")
        except Exception as e:
            print(f"Error fetching yields from yfinance: {e}")
        
        print(f"Total maturities fetched: {len(data)} - {list(data.keys())}")
    except Exception as e:
        import traceback
        print(f"Error in get_yield_curve: {e}")
        traceback.print_exc()
        # Return empty dict instead of raising - let caller handle it
    
    return data

def maturity_to_years(maturity_str):
    """Convert maturity string to years for sorting"""
    if maturity_str.endswith('W'):
        return int(maturity_str[:-1]) / 52.0
    elif maturity_str.endswith('M'):
        return int(maturity_str[:-1]) / 12.0
    elif maturity_str.endswith('Y'):
        return float(maturity_str[:-1])
    return 0.0

def calculate_dv01(face_value, duration, yield_percent):
    """Calculate DV01"""
    return duration * 0.0001 * face_value

