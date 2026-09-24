"""Vercel serverless function: /api/fedwatch"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from shared import fetch_fedwatch_data, make_handler

handler = make_handler(fetch_fedwatch_data, cache_seconds=600)
