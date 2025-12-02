# Fix Render "Not Found" Error

## The Problem
The backend is running but can't find the frontend files because they're not built/copied to the right location.

## Solution: Deploy Frontend Separately (Recommended)

### Step 1: Get Your Backend URL
Your backend should be at: `https://rates-dashboard-x9j8.onrender.com` (or similar)

### Step 2: Deploy Frontend as Static Site on Render

1. **In Render Dashboard**, click "New +" → "Static Site"

2. **Connect Repository**: Select `GShreyasP/Rates_Dashboard`

3. **Configure**:
   - **Name**: `rates-dashboard-frontend`
   - **Root Directory**: `Frontend/frontend`
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `dist`
   - **Plan**: Free

4. **Add Environment Variable**:
   - Key: `VITE_API_URL`
   - Value: `https://rates-dashboard-x9j8.onrender.com` (your backend URL)

5. **Click "Create Static Site"**

6. **Wait for deployment** - Your frontend will get its own URL like `https://rates-dashboard-frontend.onrender.com`

## Alternative: Build Frontend in Backend (Single Service)

If you want everything in one service, update your Render backend service:

1. Go to your backend service in Render dashboard
2. Click "Settings"
3. Update **Build Command** to:
   ```
   cd ../Frontend/frontend && npm install && npm run build && cd ../../Backend && mkdir -p dist && cp -r ../Frontend/frontend/dist/* dist/ && pip install -r requirements.txt
   ```
4. Save and redeploy

## Test Your Backend API

While you're setting up, test that your backend API works:
- `https://rates-dashboard-x9j8.onrender.com/api/fedwatch`
- `https://rates-dashboard-x9j8.onrender.com/api/rates`
- `https://rates-dashboard-x9j8.onrender.com/api/macro`

If these work, your backend is fine - you just need to deploy the frontend!

