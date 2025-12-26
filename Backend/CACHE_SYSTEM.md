# Cache System Documentation

## Overview
The dashboard now uses a CSV/JSON-based persistent cache system to dramatically improve load times. Data is stored locally and only updated every 3 days, eliminating the need for API calls on every page load.

## How It Works

### Two-Tier Caching System
1. **Persistent Cache (JSON files)**: Data is stored in `Backend/data_cache/` directory
   - Files are updated automatically every 3 days
   - Data persists across server restarts
   - Much faster than API calls

2. **Memory Cache (Short-term)**: Data cached in memory for 5 minutes
   - Provides instant responses for repeated requests
   - Automatically populated from persistent cache

### Automatic Updates
- Background worker checks every 12 hours if data is older than 3 days
- When data is older than 3 days, it automatically fetches fresh data from APIs
- Updates happen in the background without affecting user experience

### Cache Files
- `macro.json` - Macroeconomic indicators (CPI, PPI, Payrolls, PMI, Unemployment Claims)
- `rates.json` - Yield curve data and analysis
- `fedwatch.json` - FedWatch probabilities and rate expectations
- `*_timestamp.txt` - Timestamp files tracking when each dataset was last updated

## API Endpoints

### Standard Endpoints (Use CSV Cache)
- `GET /api/macro` - Returns macro data from cache or fetches if needed
- `GET /api/rates` - Returns rates data from cache or fetches if needed
- `GET /api/fedwatch` - Returns FedWatch data from cache or fetches if needed

### Admin Endpoints
- `GET /api/cache-status` - Check status of all caches (age, validity)
- `GET /api/update-cache` - Manually trigger cache update for all data types

## Performance Benefits
- **First load**: Loads from CSV cache (instant, no API calls)
- **Subsequent loads**: Uses memory cache (even faster)
- **After 3 days**: Background worker updates cache automatically
- **Manual override**: Use `/api/update-cache` to force immediate update

## Cache Directory
Cache files are stored in: `Backend/data_cache/`
- Automatically created on first run
- Included in `.gitignore` (not committed to git)
- Persists across deployments

## Configuration
Update interval can be changed in `cache_manager.py`:
```python
DATA_UPDATE_INTERVAL = timedelta(days=3)  # Change this to adjust update frequency
```




