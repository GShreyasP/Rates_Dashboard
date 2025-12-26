"""Shared utilities for Vercel serverless functions"""
import os
from datetime import datetime, timedelta

# Get API Key from environment variable
FRED_API_KEY = os.getenv("FRED_API_KEY", "YOUR_API_KEY_HERE")




