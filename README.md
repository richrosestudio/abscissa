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
From the **repository root** (same folder as `package.json`):

This repo includes [`.vercel/project.json`](.vercel/project.json) so the CLI targets the same Vercel project as Git production — **`abscissalive`** (custom domain [abscissa.live](https://abscissa.live)). If you rename or split Vercel projects, run `npx vercel link` again and commit the updated `project.json`. You still need to be logged in: `npx vercel login` (first time on the machine).

**Re-linking only** (different machine account or wrong project): run `npx vercel link`, answer **`Y`** at the first “Set up …?” prompt, then choose the correct team and **Link to existing project** (the one attached to [abscissa.live](https://abscissa.live) if you use that domain).

**Every deploy** (build locally, then upload a **production** deployment):
```bash
npm run deploy
```
Deploy runs `npm run build`, then the Vercel CLI with **`--scope` set from your `.vercel/project.json` team** so production goes to the right account. The CLI should print a **Production** URL and “Aliased” to your `*.vercel.app` domain.

**If deploy fails or the live site looks wrong**

- Run **`npm run build`** alone first — fix any TypeScript/Vite errors before deploy.
- Run **`npx vercel whoami`** — you must be logged in as a user who belongs to the team in [`.vercel/project.json`](.vercel/project.json). If not: `npx vercel login`.
- After a successful deploy, open the **Production** URL and the **Aliased** `*.vercel.app` line from the terminal. If those show your changes but **[abscissa.live](https://abscissa.live)** does not, the custom domain is not on this project or DNS is wrong — use **Vercel → Project → Domains**.

If the CLI works but the site does not update: confirm **Vercel → Project → Domains** lists your domain on this same project and DNS is valid.

**Deploy only from Git** (no CLI): connect the repo under the same Vercel project and push to the production branch (usually `main`); then you do not need `npm run deploy`.

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
