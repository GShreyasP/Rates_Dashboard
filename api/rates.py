"""Vercel serverless function for rates data"""
import json
from shared import get_yield_curve, maturity_to_years, calculate_dv01

def fetch_rates_data():
    """Fetch rates data"""
    yields = get_yield_curve()
    
    if not yields:
        return {"error": "Failed to fetch yields"}

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
    dv01 = calculate_dv01(10_000_000, 8.0, yields.get('10Y', 4.0))

    # Sort yields by maturity
    sorted_yields = dict(sorted(yields.items(), key=lambda x: maturity_to_years(x[0])))
    
    # Create yield curve data for charting
    yield_curve_data = [
        {"maturity": k, "years": maturity_to_years(k), "yield": v}
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

def handler(request):
    """Vercel serverless function handler"""
    try:
        data = fetch_rates_data()
        
        if 'error' in data:
            return {
                "statusCode": 500,
                "headers": {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*"
                },
                "body": json.dumps(data)
            }
        
        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            },
            "body": json.dumps(data)
        }
    except Exception as e:
        return {
            "statusCode": 500,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            "body": json.dumps({"error": str(e)})
        }
