# Deploying to Render - Step by Step Guide

## Why Render?
- ✅ **Free tier** (no credit card required)
- ✅ Supports both Flask backend and React frontend
- ✅ Auto-deploys from GitHub
- ✅ Easy to set up
- ✅ Good documentation

## Step 1: Deploy Backend (Flask API)

1. **Go to Render**: https://render.com
   - Sign up/login with GitHub (free, no credit card needed)

2. **Create New Web Service**:
   - Click "New +" → "Web Service"
   - Connect your GitHub repository: `GShreyasP/Rates_Dashboard`

3. **Configure Backend**:
   - **Name**: `rates-dashboard-api` (or any name you like)
   - **Root Directory**: `Backend`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn app:app --bind 0.0.0.0:$PORT`
   - **Plan**: Free

4. **Add Environment Variable** (optional, for macro data):
   - Click "Advanced" → "Add Environment Variable"
   - Key: `FRED_API_KEY`
   - Value: (your FRED API key if you have one)

5. **Deploy**:
   - Click "Create Web Service"
   - Wait 2-3 minutes for deployment
   - Copy the URL (e.g., `https://rates-dashboard-api.onrender.com`)

## Step 2: Update Frontend to Use Render Backend

The frontend is already configured to use `VITE_API_URL` environment variable.

## Step 3: Deploy Frontend (Static Site)

1. **Create New Static Site**:
   - In Render dashboard, click "New +" → "Static Site"
   - Connect your GitHub repository: `GShreyasP/Rates_Dashboard`

2. **Configure Frontend**:
   - **Name**: `rates-dashboard-frontend`
   - **Root Directory**: `Frontend/frontend`
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `dist`
   - **Plan**: Free

3. **Add Environment Variable**:
   - Click "Add Environment Variable"
   - Key: `VITE_API_URL`
   - Value: `https://rates-dashboard-api.onrender.com` (your backend URL from Step 1)

4. **Deploy**:
   - Click "Create Static Site"
   - Wait for deployment
   - Your site will be live!

## Alternative: Deploy Frontend to Netlify (Easier)

If you prefer, you can deploy the frontend to Netlify instead:

1. Go to https://netlify.com
2. Sign up/login with GitHub
3. Click "Add new site" → "Import an existing project"
4. Select your repository
5. Configure:
   - **Base directory**: `Frontend/frontend`
   - **Build command**: `npm install && npm run build`
   - **Publish directory**: `Frontend/frontend/dist`
6. Add environment variable:
   - Key: `VITE_API_URL`
   - Value: `https://rates-dashboard-api.onrender.com`
7. Deploy!

## Notes:

- Render free tier spins down after 15 minutes of inactivity (first request takes ~30 seconds)
- Both services auto-deploy on git push
- Backend URL will be something like: `https://rates-dashboard-api.onrender.com`
- Frontend URL will be something like: `https://rates-dashboard-frontend.onrender.com` or your Netlify URL




