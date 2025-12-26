# Deploying to Render

## Step 1: Deploy Backend (Flask API)

1. Go to https://render.com and sign up/login (free, no credit card needed)

2. Click "New +" → "Web Service"

3. Connect your GitHub repository: `GShreyasP/Rates_Dashboard`

4. Configure the backend service:
   - **Name**: `rates-dashboard-api`
   - **Root Directory**: `Backend`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn app:app --bind 0.0.0.0:$PORT`
   - **Plan**: Free

5. Add Environment Variable:
   - Key: `FRED_API_KEY`
   - Value: (your FRED API key, if you have one)

6. Click "Create Web Service"

7. Wait for deployment and copy the URL (e.g., `https://rates-dashboard-api.onrender.com`)

## Step 2: Update Frontend API URL

Update the frontend to use the Render backend URL instead of localhost.

## Step 3: Deploy Frontend (Static Site)

1. In Render dashboard, click "New +" → "Static Site"

2. Connect your GitHub repository: `GShreyasP/Rates_Dashboard`

3. Configure:
   - **Name**: `rates-dashboard-frontend`
   - **Root Directory**: `Frontend/frontend`
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `dist`
   - **Plan**: Free

4. Add Environment Variable:
   - Key: `REACT_APP_API_URL` or `VITE_API_URL`
   - Value: `https://rates-dashboard-api.onrender.com` (your backend URL from Step 1)

5. Click "Create Static Site"

## Alternative: Single Service Approach

You can also deploy just the backend on Render and keep the frontend on Vercel/Netlify pointing to the Render backend.




