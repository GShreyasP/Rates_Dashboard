# Deploy

Single target: **Vercel**. Frontend is a static Vite build; backend is Python
serverless functions under `api/`. No separate hosting, no Render.

## Structure

```
api/                  # Vercel serverless functions (Python)
  shared.py           # FRED client, macro/rates/fedwatch logic
  rates.py            # /api/rates
  macro.py            # /api/macro
  fedwatch.py         # /api/fedwatch
  data-updated.py     # /api/data-updated (no-op stub)
  requirements.txt    # `requests` only
Frontend/             # Vite + React app
  src/                # App.jsx, ErrorBoundary.jsx, App.css, index.css
  package.json
  vite.config.js
vercel.json           # build + rewrite config
```

## Environment variables (Vercel dashboard → Project → Settings → Environment)

| Key            | Required | Notes                                        |
|----------------|----------|----------------------------------------------|
| `FRED_API_KEY` | yes      | Free from https://fred.stlouisfed.org/       |

## First-time deploy

```bash
npm i -g vercel
vercel link          # associate repo with a Vercel project
vercel env add FRED_API_KEY production
vercel --prod
```

## Local dev

```bash
cd Frontend && npm install
cd ..
vercel dev           # serves the frontend AND /api together on http://localhost:3000
```

If you want to run the Vite dev server on its own (no /api), set
`VITE_API_URL=https://your-deployment.vercel.app` and run `npm run dev` in
`Frontend/`.

## Caching model

There is no filesystem cache — Vercel functions are stateless and the disk is
ephemeral. Caching happens in two places:

- **Warm-lambda memo** (`shared.py` `memoize()`): 5–30 min TTL per container.
- **Vercel edge cache**: each function sets `Cache-Control: s-maxage=…` so
  responses are served from the edge until they expire.

To force-fresh, redeploy or wait out the TTL — there is no `/api/clear-cache`
endpoint in the serverless version.
