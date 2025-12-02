"""Vercel serverless function for macro data"""
from http.server import BaseHTTPRequestHandler
import json
import os
from datetime import datetime, timedelta
import pandas_datareader.data as web

# Get API Key from environment variable
FRED_API_KEY = os.getenv("FRED_API_KEY", "YOUR_API_KEY_HERE")

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        """Fetch macro data from FRED"""
        series_map = {
            "CPI": "CPIAUCSL", 
            "PPI": "PPIACO", 
            "Payrolls": "PAYEMS",
            "PMI": "NAPM",
            "Unemployment Claims": "ICSA"
        }
        
        pmi_alternatives = ["MANPMI", "UMCSENT"]
        response_data = {}
        start_date = datetime(2022, 1, 1)
        
        if FRED_API_KEY == "YOUR_API_KEY_HERE":
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Missing FRED API Key"}).encode('utf-8'))
            return

        try:
            end_date = datetime.now() + timedelta(days=60)
            
            for name, series_id in series_map.items():
                try:
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
                            continue
                    else:
                        df = web.DataReader(series_id, 'fred', start_date, end_date, api_key=FRED_API_KEY)
                        df = df.reset_index()
                    
                    df = df.dropna(subset=[series_id])
                    
                    if len(df) == 0:
                        continue
                    
                    df = df.sort_values('DATE')
                    df = df.drop_duplicates(subset='DATE', keep='last')
                    
                    df['date'] = df['DATE'].dt.strftime('%Y-%m-%d')
                    df['pct_change'] = df[series_id].pct_change() * 100
                    df['pct_change'] = df['pct_change'].fillna(0)
                    
                    latest = float(df[series_id].iloc[-1])
                    latest_date = df['date'].iloc[-1]
                    prev = float(df[series_id].iloc[-2]) if len(df) > 1 else latest
                    change = ((latest - prev) / prev) * 100 if prev != 0 else 0
                    
                    history_data = df[['date', series_id, 'pct_change']].copy()
                    history_data[series_id] = history_data[series_id].astype(float)
                    history_data['pct_change'] = history_data['pct_change'].astype(float).round(2)
                    history_data = history_data.rename(columns={series_id: 'value'})
                    
                    response_data[name] = {
                        "history": history_data.to_dict(orient='records'),
                        "current": latest,
                        "latest_date": latest_date,
                        "change": round(change, 2)
                    }
                except Exception as e:
                    print(f"Error fetching {name}: {e}")
                    continue
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
            return
            
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(response_data).encode('utf-8'))
        return
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        return

