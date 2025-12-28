"""Vercel serverless function for FedWatch data"""
from http.server import BaseHTTPRequestHandler
import json
from datetime import datetime

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            # Calculate next FOMC meeting date (January 28, 2026)
            next_meeting = datetime(2026, 1, 28)
            
            # Hardcoded target rate probabilities
            # 325-350: 18.8%, 350-375: 81.2%
            target_rate_probabilities = {
                "325-350": 18.8,
                "350-375": 81.2
            }
            
            most_likely = max(target_rate_probabilities.items(), key=lambda x: x[1])
            
            response_data = {
                "next_meeting_date": next_meeting.strftime("%d %b %Y"),  # Format: "28 Jan 2026"
                "target_rate_probabilities": target_rate_probabilities,
                "most_likely_change": most_likely[0],
                "most_likely_probability": round(most_likely[1], 1),
                "current_target_rate": "350-375",
                "current_fed_rate": 3.5,
                "source": "FedWatch Data"
            }
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(response_data).encode('utf-8'))
        except Exception as e:
            import traceback
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e), "traceback": traceback.format_exc()}).encode('utf-8'))
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        return
