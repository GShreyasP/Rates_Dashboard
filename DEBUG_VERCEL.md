# Debugging Vercel Serverless Functions

## Quick Checks:

### 1. Check Function Logs in Vercel Dashboard
1. Go to your Vercel project
2. Click on the latest deployment
3. Click on the **"Functions"** tab
4. Look for errors in the logs for each function (`/api/macro`, `/api/rates`, `/api/fedwatch`)

### 2. Test Basic Function
Visit: `https://your-app.vercel.app/api/test`
- Should return: `{"message": "API is working", "test": true}`
- If this works, functions are being detected correctly
- If this fails, there's a deployment/routing issue

### 3. Test Each Endpoint
- `/api/fedwatch` - Should work immediately (no dependencies)
- `/api/rates` - Requires yfinance, pandas
- `/api/macro` - Requires FRED_API_KEY + pandas, pandas-datareader

### 4. Check Environment Variables
In Vercel Dashboard → Settings → Environment Variables:
- `FRED_API_KEY` should be set (if you want macro data)

### 5. Common Issues:

**Issue: Functions return 404**
- Functions might not be detected
- Check that files are in `api/` directory
- Verify `vercel.json` isn't blocking them

**Issue: Functions return 500**
- Check function logs in Vercel dashboard
- Likely import error or missing dependency
- Python dependencies from `api/requirements.txt` might not be installing

**Issue: CORS errors in browser**
- Functions should include CORS headers (already added)
- Check browser console for specific error

### 6. Test Locally with Vercel CLI (Optional)
```bash
npm i -g vercel
vercel dev
```
This runs your project locally with Vercel's serverless functions

## Next Steps:
If `/api/test` works but other endpoints don't:
1. Check function logs for specific errors
2. Verify `FRED_API_KEY` is set (for macro data)
3. Check that all Python dependencies are in `api/requirements.txt`

