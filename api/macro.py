"""Vercel serverless function for macro data"""
import json
import os
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
import pandas_datareader.data as web
import pandas as pd

# Get API Key from environment variable
FRED_API_KEY = os.getenv("FRED_API_KEY", "YOUR_API_KEY_HERE")

def fetch_macro_data():
    """Fetch macro data from FRED - optimized with parallel fetching"""
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
    start_date = datetime.now() - timedelta(days=550)  # ~18 months
    
    if FRED_API_KEY == "YOUR_API_KEY_HERE":
        return {"error": "Missing FRED API Key"}

    def fetch_series(name, series_id):
        """Helper function to fetch a single series"""
        try:
            end_date = datetime.now() + timedelta(days=60)
            
            if name == "PMI":
                df = None
                for alt_id in [series_id] + pmi_alternatives:
                    try:
                        df = web.DataReader(alt_id, 'fred', start_date, end_date, api_key=FRED_API_KEY)
                        df = df.reset_index()
                        series_id = alt_id
                        break
                    except:
                        continue
                if df is None or len(df) == 0:
                    return None
            else:
                df = web.DataReader(series_id, 'fred', start_date, end_date, api_key=FRED_API_KEY)
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
                    latest_date_obj = pd.to_datetime(latest_date)
                    one_year_ago = latest_date_obj - pd.DateOffset(years=1)
                    df['DATE_dt'] = pd.to_datetime(df['DATE'])
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
    
    # Fetch all series in parallel
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(fetch_series, name, series_id): name 
                  for name, series_id in series_map.items()}
        
        for future in as_completed(futures):
            result = future.result()
            if result:
                response_data[result['name']] = result['data']
    
    return response_data

def handler(request):
    """Vercel serverless function handler"""
    try:
        # Fetch fresh data (no caching in serverless - Vercel handles it at CDN level)
        data = fetch_macro_data()
        
        if 'error' in data:
            return {
                "statusCode": 500,
                "headers": {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*"
                },
                "body": json.dumps(data)
            }
        
        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            },
            "body": json.dumps(data)
        }
    except Exception as e:
        return {
            "statusCode": 500,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            "body": json.dumps({"error": str(e)})
        }
