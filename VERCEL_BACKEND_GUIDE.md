# Deploy Backend to Vercel (No Spin-Down!)

If you want to solve the spin-down problem completely, deploy your backend to Vercel as serverless functions.

## Why Vercel Backend?
- ✅ **No spin-downs** - Serverless functions stay ready
- ✅ **Fast cold starts** - ~100-500ms (much faster than Render's 30-60s)
- ✅ **Same platform** - Frontend and backend together
- ✅ **Free tier** - Generous limits
- ⚠️ **Needs conversion** - From Flask to serverless functions

## Current Status

You already have serverless function stubs in the `api/` folder:
- `api/macro.py` - Partial implementation
- `api/rates.py` - Partial implementation  
- `api/fedwatch.py` - Partial implementation

These need to be updated to match your full Flask backend functionality.

## Implementation Steps

### 1. Create `vercel.json` Configuration

Create `vercel.json` in project root:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "api/**/*.py",
      "use": "@vercel/python"
    },
    {
      "src": "Frontend/frontend/package.json",
      "use": "@vercel/static-build",
      "config": {
        "distDir": "dist"
      }
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "/api/$1"
    },
    {
      "src": "/(.*)",
      "dest": "/Frontend/frontend/$1"
    }
  ],
  "env": {
    "FRED_API_KEY": "@fred_api_key"
  }
}
```

### 2. Update Serverless Functions

Each Flask route needs to become a serverless function:

**Current Flask route:**
```python
@app.route('/api/macro')
def macro_data():
    # ... code ...
    return jsonify(data)
```

**Vercel serverless function:**
```python
# api/macro.py
def handler(request):
    # ... same code, but return dict instead of jsonify ...
    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        "body": json.dumps(data)
    }
```

### 3. Handle Caching

Vercel serverless functions can use:
- Environment variables for secrets
- `/tmp` directory for temporary files (ephemeral)
- External cache (Redis, Upstash) for persistent cache

You'll need to adapt your cache system to use an external service or Vercel KV (key-value store).

### 4. Deploy to Vercel

1. Install Vercel CLI: `npm i -g vercel`
2. Run: `vercel`
3. Set environment variables in Vercel dashboard
4. Deploy: `vercel --prod`

## Alternative: Quick Fix with Keep-Alive

If you don't want to convert to serverless functions right now, the easiest solution is:

1. **Keep Render backend** (as-is)
2. **Deploy frontend to Vercel** (faster CDN)
3. **Set up UptimeRobot** (free keep-alive service)

This gives you:
- Fast frontend (Vercel CDN)
- Working backend (Render, kept awake)
- No code changes needed
- Solves the spin-down problem

## Recommendation

**Short-term**: Use Option 1 (Render + Vercel + Keep-Alive)
- No code changes needed
- Solves spin-down issue
- Fast frontend

**Long-term**: Migrate to Vercel serverless
- Best performance
- No spin-down ever
- Single platform
- But requires code conversion

