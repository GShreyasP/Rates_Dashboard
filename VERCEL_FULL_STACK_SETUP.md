# Full Stack Deployment on Vercel

This guide shows you how to deploy both frontend and backend to Vercel. **You don't need to delete your existing project** - just update the configuration!

## ✅ What's Been Done:

1. **Backend converted to serverless functions** in `api/` folder:
   - `api/macro.py` - Full macro data endpoint
   - `api/rates.py` - Yield curve data endpoint  
   - `api/fedwatch.py` - FedWatch probabilities endpoint
   - `api/data-updated.py` - Data update checker
   - `api/shared.py` - Shared utilities

2. **Frontend configured** to use relative API paths (`/api`) when on Vercel

3. **vercel.json** configured to route API calls to serverless functions

## 🚀 Setup Steps:

### 1. Go to Your Vercel Project

1. Go to https://vercel.com
2. Click on your `rates-dashboard` project
3. Go to **Settings** → **General**

### 2. Update Root Directory

- **Root Directory**: Leave as default (project root) or set to `.`
- Vercel will use `vercel.json` which handles everything

### 3. Add Environment Variable

Go to **Settings** → **Environment Variables**:

- **Key**: `FRED_API_KEY`
- **Value**: Your FRED API key (if you have one)
- **Environments**: Production, Preview, Development
- Click **Save**

> **Note**: If you don't have a FRED API key, some data (like macro indicators) won't work, but rates and FedWatch will still work.

### 4. Verify Build Settings

Go to **Settings** → **Build & Development Settings**:

The `vercel.json` file handles this automatically, but verify:
- **Build Command**: Should be handled by `vercel.json` (builds from `Frontend/frontend`)
- **Output Directory**: Should be `Frontend/frontend/dist`
- **Install Command**: `npm install` (default)

### 5. Redeploy

**Option A: Auto-deploy (Recommended)**
- Just push to GitHub - Vercel will auto-deploy

**Option B: Manual Redeploy**
1. Go to **Deployments** tab
2. Click **three dots** (...) on latest deployment
3. Click **Redeploy**

## 📁 File Structure:

```
your-repo/
├── api/                    # Serverless functions (backend)
│   ├── macro.py           # /api/macro endpoint
│   ├── rates.py           # /api/rates endpoint
│   ├── fedwatch.py        # /api/fedwatch endpoint
│   ├── data-updated.py    # /api/data-updated endpoint
│   ├── shared.py          # Shared utilities
│   └── requirements.txt   # Python dependencies
├── Frontend/frontend/      # React frontend
│   ├── src/
│   └── package.json
├── vercel.json            # Vercel configuration
└── ...
```

## 🎯 How It Works:

1. **Frontend**: Served as static site from `Frontend/frontend/dist`
2. **API Routes**: Any request to `/api/*` goes to Python serverless functions
3. **No Spin-Down**: Serverless functions stay warm, no cold starts like Render!

## ⚡ Benefits of Vercel:

- ✅ **No spin-downs** - Functions stay ready
- ✅ **Fast cold starts** - ~100-500ms (vs Render's 30-60s)
- ✅ **Global CDN** - Frontend served from edge locations
- ✅ **Auto-deploys** - Push to GitHub = instant deploy
- ✅ **Both on one platform** - Easier to manage

## 🔍 Testing:

After deployment, test these URLs:
- `https://your-app.vercel.app` - Frontend
- `https://your-app.vercel.app/api/fedwatch` - FedWatch data
- `https://your-app.vercel.app/api/rates` - Rates data
- `https://your-app.vercel.app/api/macro` - Macro data

## 📝 Important Notes:

1. **No persistent caching**: Serverless functions don't have file storage, so we fetch fresh data each time. This is fine because:
   - Vercel caches at the CDN level
   - Functions are fast
   - No spin-down delays

2. **FRED API Key**: Optional but recommended for full macro data. Without it:
   - Rates data will work (uses yfinance)
   - FedWatch will work (hardcoded)
   - Macro data will be limited

3. **Environment Variables**: Make sure `FRED_API_KEY` is set in Vercel dashboard

## 🐛 Troubleshooting:

**Build fails:**
- Check that `Frontend/frontend/package.json` exists
- Verify `vercel.json` is in project root
- Check build logs in Vercel dashboard

**API returns 404:**
- Verify `api/` folder has Python files
- Check that routes in `vercel.json` are correct
- Make sure functions are in `api/` folder (not `Backend/`)

**API returns 500:**
- Check function logs in Vercel dashboard
- Verify `FRED_API_KEY` is set if using macro data
- Check that `requirements.txt` has all dependencies

**CORS errors:**
- All functions already include CORS headers
- Should work automatically

## ✅ Done!

Once deployed, your entire app (frontend + backend) will be on Vercel with:
- Fast load times
- No spin-downs
- Global CDN
- Auto-deployments

No need to delete your existing project - just update the configuration above and redeploy!

