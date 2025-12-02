"""Vercel serverless function for FedWatch data"""
from http.server import BaseHTTPRequestHandler
from datetime import datetime
import json

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        """Fetch FedWatch interest rate cut odds - hardcoded data"""
        
        # Calculate next FOMC meeting date (December 10, 2025 based on image)
        next_meeting = datetime(2025, 12, 10)
        
        # Hardcoded target rate probabilities from image
        # 350-375: 87.2%, 375-400: 12.8%
        target_rate_probabilities = {
            "350-375": 87.2,
            "375-400": 12.8
        }
        
        most_likely = max(target_rate_probabilities.items(), key=lambda x: x[1])
        
        response_data = {
            "next_meeting_date": next_meeting.strftime("%B %d, %Y"),
            "target_rate_probabilities": target_rate_probabilities,
            "most_likely_change": most_likely[0],
            "most_likely_probability": round(most_likely[1], 1),
            "current_target_rate": "375-400",
            "current_fed_rate": 3.75,
            "source": "FedWatch Data"
        }
        
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

