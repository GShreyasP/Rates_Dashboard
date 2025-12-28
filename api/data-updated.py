"""Vercel serverless function to check for data updates"""
import json

def handler(request=None):
    """Check if data has been updated - simplified for serverless"""
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
    
    # In serverless, we don't have persistent cache flags
    # This endpoint always returns no updates (data is always fresh)
    # You could implement a more sophisticated solution with Vercel KV or similar
    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        },
        "body": json.dumps({
            "updated": False,
            "updated_data": {},
            "timestamp": "2025-01-01T00:00:00"
        })
    }

