# Fixing Vercel Python Functions 404 Issue

## The Problem
The API endpoints are returning 404, meaning Vercel isn't detecting or deploying the Python serverless functions.

## Critical Check in Vercel Dashboard

### 1. Check Root Directory Setting
1. Go to your Vercel project dashboard
2. Click **Settings** → **General**
3. **VERIFY "Root Directory"** - It should be:
   - Either **empty/blank** (meaning root of repo)
   - OR set to `.` (current directory)
   
   **If it's set to `Frontend/frontend`, that's the problem!** 
   Vercel will only deploy from that directory and ignore the `api/` folder at the root.

### 2. Check Functions Tab
1. Go to your latest deployment
2. Click the **"Functions"** tab
3. Do you see any Python functions listed?
   - If **NO**: Functions aren't being detected
   - If **YES**: Check their logs for errors

### 3. Verify Files Are Deployed
In the deployment logs, you should see Python files being detected. If you only see frontend build logs, the `api/` directory isn't being included.

## Quick Fix Options

### Option A: Root Directory is Wrong
If Root Directory is set to `Frontend/frontend`:
1. Change it to `.` or leave it blank
2. Redeploy

### Option B: Files Not in Deployment
If `api/` files aren't being deployed:
1. Check `.gitignore` - make sure `api/` isn't ignored
2. Verify files are committed: `git ls-files api/`
3. Check Vercel's deployment includes them

### Option C: Different Vercel Configuration
Try updating `vercel.json` to be more explicit:

```json
{
  "buildCommand": "cd Frontend/frontend && npm install && npm run build",
  "outputDirectory": "Frontend/frontend/dist",
  "functions": {
    "api/**/*.py": {
      "runtime": "@vercel/python"
    }
  },
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "/api/$1"
    },
    {
      "src": "/(.*)",
      "dest": "/index.html"
    }
  ]
}
```

## After Fixing

1. **Trigger a new deployment** (push a commit or manually redeploy)
2. **Check Build Logs** - you should see Python functions being detected
3. **Check Functions Tab** - functions should appear
4. **Test** - `/api/test` should return JSON, not 404

## Still Not Working?

Check these in order:
1. ✅ Root Directory in Vercel settings
2. ✅ Files committed to git (`git ls-files api/`)
3. ✅ Build logs show Python detection
4. ✅ Functions tab shows deployed functions
5. ✅ Function logs show execution (even if errors)

