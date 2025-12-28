"""Shared utilities for Vercel serverless functions"""
import os
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
        # Yahoo Finance tickers
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
                        data[label] = float(hist['Close'].iloc[-1])
                except Exception as e:
                    print(f"Error fetching {label} ({ticker}) from yfinance: {e}")
        except Exception as e:
            print(f"Error fetching yields from yfinance: {e}")
        
        # FRED API Treasury constant maturity rates
        fred_series = {
            '1M': 'DGS1MO',
            '2M': 'DGS2MO',
            '3M': 'DGS3MO',
            '4M': 'DGS4MO',
            '6M': 'DGS6MO',
            '1Y': 'DGS1',
            '2Y': 'DGS2',
            '7Y': 'DGS7'
        }
        
        if FRED_API_KEY != "YOUR_API_KEY_HERE":
            try:
                end_date = datetime.now()
                start_date = end_date - timedelta(days=5)
                
                for label, series_id in fred_series.items():
                    try:
                        df = web.DataReader(series_id, 'fred', start_date, end_date, api_key=FRED_API_KEY)
                        if not df.empty:
                            series_data = df[series_id].dropna()
                            if len(series_data) > 0:
                                data[label] = float(series_data.iloc[-1])
                    except Exception as e:
                        print(f"Error fetching {label} ({series_id}) from FRED: {e}")
            except Exception as e:
                print(f"Error fetching yields from FRED: {e}")
        else:
            print("Warning: FRED_API_KEY not set, skipping FRED yield data")
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

