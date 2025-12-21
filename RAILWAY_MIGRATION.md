# Migrate from Render to Railway.app

## Why Railway is Better for Free Tier:

✅ **No aggressive spin-downs** - Services stay running longer  
✅ **Faster cold starts** - ~5-10 seconds vs Render's 30-60 seconds  
✅ **Better performance** - Faster overall response times  
✅ **Persistent storage** - Better handling of cache files  
✅ **Free $5/month credit** - More generous than Render  
✅ **Easier deployment** - Simpler setup process  

## Migration Steps:

### 1. Sign up for Railway
- Go to https://railway.app
- Sign up with GitHub (free, $5/month credit)

### 2. Create New Project
- Click "New Project"
- Select "Deploy from GitHub repo"
- Choose your repository: `GShreyasP/Rates_Dashboard`

### 3. Deploy Backend

Railway will auto-detect it's a Python project. Configure:

- **Root Directory**: `Backend`
- **Start Command**: `gunicorn app:app --bind 0.0.0.0:$PORT`
- **Build Command**: (leave default or set to `pip install -r requirements.txt`)

### 4. Add Environment Variables
In Railway dashboard, go to "Variables" tab:
- `FRED_API_KEY` = (your FRED API key)
- `PORT` = (auto-set by Railway, don't override)

### 5. Deploy Frontend (Separate Service)

**Option A: Railway Static Site**
1. Add another service in the same project
2. Type: "Static Site"
3. Root Directory: `Frontend/frontend`
4. Build Command: `npm install && npm run build`
5. Output Directory: `dist`
6. Add variable: `VITE_API_URL` = (your backend Railway URL)

**Option B: Keep Frontend on Vercel/Netlify (Recommended)**
- Vercel/Netlify are faster for static sites
- Deploy frontend there, point to Railway backend URL
- Better global CDN distribution

### 6. Update Frontend API URL
Once Railway backend is deployed, update your frontend's API URL:
- Railway backend URL looks like: `https://your-app.up.railway.app`

### 7. Cancel Render Service
Once Railway is working, you can stop/delete the Render service.

## Performance Comparison:

| Feature | Render Free | Railway Free |
|---------|-------------|--------------|
| Cold Start | 30-60 seconds | 5-10 seconds |
| Spin-down Time | 15 minutes | ~30+ minutes |
| Response Time | Slow | Fast |
| Storage | Ephemeral | Persistent |
| Monthly Credit | None | $5 |

## Alternative: Keep Render but Use Keep-Alive

If you want to stay on Render, you can use a free keep-alive service:
1. Sign up for https://uptimerobot.com (free)
2. Add a monitor for your Render URL
3. Set it to ping every 5 minutes
4. This keeps the service alive, eliminating cold starts

However, Railway is still recommended for better overall performance.

