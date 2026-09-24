"""Vercel serverless function: /api/macro"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from shared import fetch_macro_data, make_handler

handler = make_handler(fetch_macro_data, cache_seconds=1800)
