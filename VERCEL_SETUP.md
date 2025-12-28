# Vercel Frontend Setup Guide

## ✅ You DON'T Need to Delete the Project!

Your existing Vercel project is fine - just reconfigure it to point to the correct directory and set the environment variable.

## Step-by-Step Configuration:

### 1. Go to Your Vercel Project Settings

1. Go to https://vercel.com
2. Click on your `rates-dashboard` project
3. Go to **Settings** tab

### 2. Update Build Settings

Go to **Build & Development Settings**:

- **Framework Preset**: `Vite` (or leave as auto-detect)
- **Root Directory**: `Frontend/frontend`
- **Build Command**: `npm install && npm run build` (or leave default)
- **Output Directory**: `dist` (Vite default)

**OR** if you want to use the vercel.json file I created:
- Leave Root Directory as default (project root)
- Vercel will use `vercel.json` automatically

### 3. Add Environment Variable (CRITICAL!)

Go to **Environment Variables**:

1. Click **Add New**
2. Key: `VITE_API_URL`
3. Value: Your Render backend URL (e.g., `https://your-backend-name.onrender.com`)
   - **Important**: Don't include `/api` at the end - the frontend code adds it automatically
   - Example: `https://rates-dashboard-api.onrender.com` ✅
   - Not: `https://rates-dashboard-api.onrender.com/api` ❌

4. Select environments: **Production**, **Preview**, and **Development**
5. Click **Save**

### 4. Redeploy

1. Go to **Deployments** tab
2. Click the **three dots** (...) on the latest deployment
3. Click **Redeploy**
4. Or simply push to GitHub - it will auto-deploy

## That's It! 

Your Vercel frontend will now:
- ✅ Build correctly from `Frontend/frontend` directory
- ✅ Point to your Render backend via `VITE_API_URL`
- ✅ Auto-deploy on every git push

## Verify It Works:

1. Visit your Vercel URL: `https://rates-dashboard-orcin.vercel.app`
2. Check browser console (F12) - should see API calls to your Render backend
3. Data should load from Render backend

## Troubleshooting:

**Frontend loads but no data:**
- Check `VITE_API_URL` is set correctly in Vercel
- Check browser console for CORS errors
- Verify Render backend is running

**Build fails:**
- Make sure Root Directory is `Frontend/frontend`
- Check that `package.json` exists in that directory

**CORS errors:**
- Backend already has CORS enabled in `app.py`
- If issues persist, check Render backend logs

## No Need to Delete Project!

Your existing project will work fine - just update the configuration above. The connection to GitHub repo is correct and will auto-deploy.

