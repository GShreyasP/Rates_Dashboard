"""Vercel serverless function to check for data updates"""
from http.server import BaseHTTPRequestHandler
import json

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # In serverless, we don't have persistent cache flags
        # This endpoint always returns no updates (data is always fresh)
        # You could implement a more sophisticated solution with Vercel KV or similar
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps({
            "updated": False,
            "updated_data": {},
            "timestamp": "2025-01-01T00:00:00"
        }).encode('utf-8'))
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        return
