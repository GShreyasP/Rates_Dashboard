"""Vercel serverless function: /api/rates"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from shared import fetch_rates_data, make_handler

handler = make_handler(fetch_rates_data, cache_seconds=600)
