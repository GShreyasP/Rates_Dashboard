# Deploying to Vercel

## Prerequisites
1. Install Vercel CLI: `npm i -g vercel`
2. Have a Vercel account (sign up at vercel.com)

## Deployment Steps

### Option 1: Deploy via Vercel CLI

1. **Install Vercel CLI** (if not already installed):
   ```bash
   npm i -g vercel
   ```

2. **Login to Vercel**:
   ```bash
   vercel login
   ```

3. **Deploy**:
   ```bash
   vercel
   ```
   
   Follow the prompts:
   - Link to existing project or create new
   - Set root directory: `.` (current directory)
   - Override settings: No (use defaults)

4. **Set Environment Variables** (if needed):
   ```bash
   vercel env add FRED_API_KEY
   ```
   Enter your FRED API key when prompted.

5. **Deploy to Production**:
   ```bash
   vercel --prod
   ```

### Option 2: Deploy via GitHub Integration

1. **Push your code to GitHub** (already done)

2. **Go to Vercel Dashboard**:
   - Visit https://vercel.com/dashboard
   - Click "Add New Project"
   - Import your GitHub repository: `GShreyasP/Rates_Dashboard`

3. **Configure Project**:
   - Framework Preset: Vite
   - Root Directory: `Frontend/frontend` (or leave as `.` and Vercel will auto-detect)
   - Build Command: `cd Frontend/frontend && npm install && npm run build`
   - Output Directory: `Frontend/frontend/dist`

4. **Add Environment Variables**:
   - Go to Project Settings → Environment Variables
   - Add `FRED_API_KEY` with your API key value

5. **Deploy**:
   - Click "Deploy"
   - Vercel will automatically build and deploy your app

## API Endpoints

The API endpoints are available at:
- `/api/macro` - Macro economic data
- `/api/rates` - Yield curve and rates data
- `/api/fedwatch` - Fed rate probabilities

## Notes

- The frontend is built from `Frontend/frontend/`
- API serverless functions are in the `api/` directory
- Make sure `FRED_API_KEY` is set in Vercel environment variables if you need macro data
- The FedWatch endpoint uses hardcoded data and doesn't require API keys

