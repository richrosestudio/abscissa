# Abscissa

Real-time intraday stock portfolio tracker. [abscissa.live](https://abscissa.live)

## Running locally

### UI only (mock data)
```bash
npm run dev
```
Opens at http://localhost:5173. When markets are closed or the API is unreachable, the app shows simulated data automatically.

### UI + real Yahoo Finance data (full stack)
You need a [Vercel account](https://vercel.com) and the CLI (already installed as a dev dep):

**Terminal 1 — API server:**
```bash
npm run dev:api
# → Vercel dev server starts on http://localhost:3000
# First run will ask you to log in: npx vercel login
```

**Terminal 2 — Vite:**
```bash
npm run dev
# → http://localhost:5173 (proxies /api/* → localhost:3000)
```

## Deploying to Vercel
```bash
npx vercel --prod
```

## Tech stack
- React + TypeScript (Vite)
- [Liveline](https://github.com/benjitaylor/liveline) — real-time canvas chart
- [react-colorful](https://github.com/omgovich/react-colorful) — colour picker
- [yahoo-finance2](https://github.com/gadicc/node-yahoo-finance2) — market data (server-side only)
- Vercel — hosting + serverless functions

## Notes
- Polling pauses automatically when all relevant exchanges are closed.
- Y-axis is symmetric around 0% (±N% so the baseline is always centred).
- Symmetric Y-axis uses sentinel data-point injection until a native Liveline `yDomain` prop is contributed upstream.
