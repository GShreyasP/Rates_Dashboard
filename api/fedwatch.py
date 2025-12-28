"""Vercel serverless function for FedWatch data"""
import json
from datetime import datetime

def handler(request=None):
    """Fetch FedWatch interest rate cut odds - hardcoded data"""
    # Handle CORS preflight
    if request and request.get('method') == 'OPTIONS':
        return {
            "statusCode": 200,
            "headers": {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Max-Age": "86400"
            },
            "body": ""
        }
    
    try:
        # Calculate next FOMC meeting date (December 10, 2025 based on image)
        next_meeting = datetime(2025, 12, 10)
        
        # Hardcoded target rate probabilities
        # 350-375: 89.2%, 375-400: 10.8%
        target_rate_probabilities = {
            "350-375": 89.2,
            "375-400": 10.8
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
        
        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            },
            "body": json.dumps(response_data)
        }
    except Exception as e:
        import traceback
        return {
            "statusCode": 500,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            "body": json.dumps({"error": str(e), "traceback": traceback.format_exc()})
        }
