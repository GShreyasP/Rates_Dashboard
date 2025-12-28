"""Vercel serverless function for rates data"""
from http.server import BaseHTTPRequestHandler
import json
import sys
import os

# Add api directory to path for imports
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

# Lazy import to avoid import errors at module load time
_shared_imported = False
_get_yield_curve = None
_maturity_to_years = None
_calculate_dv01 = None

def _import_shared():
    """Lazy import of shared functions"""
    global _shared_imported, _get_yield_curve, _maturity_to_years, _calculate_dv01
    if _shared_imported:
        return
    
    try:
        from shared import get_yield_curve, maturity_to_years, calculate_dv01
        _get_yield_curve = get_yield_curve
        _maturity_to_years = maturity_to_years
        _calculate_dv01 = calculate_dv01
        _shared_imported = True
    except ImportError:
        try:
            from api.shared import get_yield_curve, maturity_to_years, calculate_dv01
            _get_yield_curve = get_yield_curve
            _maturity_to_years = maturity_to_years
            _calculate_dv01 = calculate_dv01
            _shared_imported = True
        except ImportError as e:
            print(f"Failed to import shared functions: {e}")
            raise

def fetch_rates_data():
    """Fetch rates data"""
    try:
        # Import shared functions lazily
        _import_shared()
        
        if not _shared_imported or not _get_yield_curve:
            # Return consistent structure even on error
            return {
                "yields": {},
                "yield_curve": [],
                "analysis": {
                    "spread_2s10s": 0,
                    "spread_5s30s": 0,
                    "curve_shape": "Unknown",
                    "trade_pitch": "Data unavailable",
                    "dv01_10m_position": "$0.00"
                },
                "error": "Failed to import required functions"
            }
        
        yields = _get_yield_curve()
        
        if not yields:
            # Return consistent structure even on error
            return {
                "yields": {},
                "yield_curve": [],
                "analysis": {
                    "spread_2s10s": 0,
                    "spread_5s30s": 0,
                    "curve_shape": "Unknown",
                    "trade_pitch": "Data unavailable",
                    "dv01_10m_position": "$0.00"
                },
                "error": "Failed to fetch yields"
            }

        # Curve Shape Analysis
        short_term_yield = yields.get('2Y') or yields.get('1Y') or yields.get('3M', 0)
        spread_2s10s = yields.get('10Y', 0) - short_term_yield
        spread_5s30s = yields.get('30Y', 0) - yields.get('5Y', 0)
        
        curve_shape = "Normal"
        trade_pitch = "Bear Flattener (Rates rising)"
        
        if spread_2s10s < 0:
            curve_shape = "Inverted"
            trade_pitch = "Bull Steepener (Expecting cuts)"

        # DV01 Calculation
        dv01 = _calculate_dv01(10_000_000, 8.0, yields.get('10Y', 4.0))

        # Sort yields by maturity
        sorted_yields = dict(sorted(yields.items(), key=lambda x: _maturity_to_years(x[0])))
        
        # Create yield curve data for charting
        yield_curve_data = [
            {"maturity": k, "years": _maturity_to_years(k), "yield": v}
            for k, v in sorted_yields.items()
        ]

        return {
            "yields": sorted_yields,
            "yield_curve": yield_curve_data,
            "analysis": {
                "spread_2s10s": round(spread_2s10s, 2),
                "spread_5s30s": round(spread_5s30s, 2),
                "curve_shape": curve_shape,
                "trade_pitch": trade_pitch,
                "dv01_10m_position": f"${dv01:,.2f}"
            }
        }
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback_str = traceback.format_exc()
        print(f"Error in fetch_rates_data: {error_msg}")
        print(traceback_str)
        # Return consistent structure even on error
        return {
            "yields": {},
            "yield_curve": [],
            "analysis": {
                "spread_2s10s": 0,
                "spread_5s30s": 0,
                "curve_shape": "Unknown",
                "trade_pitch": "Data unavailable",
                "dv01_10m_position": "$0.00"
            },
            "error": f"Failed to fetch rates data: {error_msg}"
        }

class handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        """Override to prevent logging errors"""
        pass
    
    def do_GET(self):
        try:
            data = fetch_rates_data()
            
            # Return 200 even if there's an error - let frontend handle it
            # Only return 500 for actual server exceptions
            status_code = 200
            if 'error' in data:
                # Log the error but still return 200 so frontend can handle gracefully
                print(f"Error in rates data: {data.get('error')}")
            
            self.send_response(status_code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            response_data = json.dumps(data).encode('utf-8')
            self.wfile.write(response_data)
        except Exception as e:
            import traceback
            error_msg = str(e)
            traceback_str = traceback.format_exc()
            print(f"Error in /api/rates handler: {error_msg}")
            print(traceback_str)
            try:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                error_response = json.dumps({"error": error_msg, "traceback": traceback_str}).encode('utf-8')
                self.wfile.write(error_response)
            except:
                # If we can't send response, just log it
                print("Failed to send error response")
    
    def do_OPTIONS(self):
        try:
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.end_headers()
        except:
            pass
        return
