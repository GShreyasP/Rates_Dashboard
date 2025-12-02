"""Vercel serverless function for rates data"""
import json
import yfinance as yf

def maturity_to_years(maturity_str):
    """Convert maturity string to years for sorting"""
    if maturity_str.endswith('W'):
        weeks = int(maturity_str[:-1])
        return weeks / 52.0
    elif maturity_str.endswith('M'):
        months = int(maturity_str[:-1])
        return months / 12.0
    elif maturity_str.endswith('Y'):
        years = int(maturity_str[:-1])
        return float(years)
    return 0.0

def get_yield_curve():
    """Get yield curve data"""
    tickers = {'13W': '^IRX', '2Y': '^IRX', '5Y': '^FVX', '10Y': '^TNX', '30Y': '^TYX'}
    data = {}
    try:
        for label, ticker in tickers.items():
            tick = yf.Ticker(ticker)
            hist = tick.history(period="1d")
            if not hist.empty:
                data[label] = float(hist['Close'].iloc[-1])
    except Exception as e:
        print(f"Error fetching yields: {e}")
    return data

def calculate_dv01(face_value, duration, yield_percent):
    """Calculate DV01"""
    return duration * 0.0001 * face_value

def handler(request):
    """Fetch rates data"""
    yields = get_yield_curve()
    
    if not yields:
        return {
            "statusCode": 500,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            "body": json.dumps({"error": "Failed to fetch yields"})
        }

    # Curve Shape Analysis
    spread_2s10s = yields.get('10Y', 0) - yields.get('13W', 0)
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

    response_data = {
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

