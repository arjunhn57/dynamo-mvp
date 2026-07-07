# DynaMo — MVP

Context-aware ad automation: CoolSip's 12 line items across 4 Indian cities flip
between three creatives based on **live weather**, every change is logged with a
reason, and the CMO gets a dashboard she can **see, trust, and override**.

**Live:** https://dynamo-murex.vercel.app
**Design + reasoning:** [`SPEC.md`](./SPEC.md) · **Write-up:** [`WRITEUP.md`](./WRITEUP.md)

## How it works

```
trigger (dashboard load / "Run now" / 3-min poll / 15-min GitHub Actions cron)
  -> for each UNIQUE city: fetch weather if cache > 15 min old   (Open-Meteo)
  -> decide(weather, override) -> which creative should be live  (pure fn)
  -> flip line-item states that changed, log each transition + why
  -> dashboard reads current state straight from Postgres
```

The decision (`lib/decide.ts`): **CMO pin wins → fail-safe to generic when weather
is missing/stale → rain beats heat → hot → generic.**

Weather is cached **per city, not per line item** — so cost scales with locations,
not campaign size (the $50/day-at-200-cities story; see `WRITEUP.md`).

## Stack

Next.js 14 (App Router) · TypeScript · Postgres (Neon serverless) · Open-Meteo
(no API key) · Vercel (host + cron).

## Run locally

```bash
npm install
cp .env.example .env          # set DATABASE_URL (Neon or Vercel Postgres)
npm run dev                   # http://localhost:3000
# first run auto-creates tables + seeds the 12 line items (or hit /api/setup)
npx tsx --test lib/decide.test.ts   # the decision-engine tests (8)
```

## Endpoints

| Route | What it does |
|---|---|
| `/` | the CMO dashboard (evaluates on load) |
| `/api/evaluate` | run the core loop (idempotent; cron + "Run now" hit this) |
| `/api/override` | set a control — `{scope, hold, pin}` |
| `/api/setup` | create tables + seed (idempotent) |

## Access

The URL is unlisted for the demo. Set `DASHBOARD_PASSCODE` to gate the dashboard
behind HTTP Basic Auth (any username + the passcode); `middleware.ts`. Left unset
so the demo opens with one click. `/api/evaluate` stays open for the cron.

## File map

```
lib/decide.ts     the decision engine (pure) + thresholds
lib/weather.ts    Open-Meteo provider (isolated, swappable)
lib/db.ts         schema, seed, typed queries
lib/evaluate.ts   the core loop
app/page.tsx      dashboard (server component)
app/Controls.tsx  CMO controls (client)
app/api/*         evaluate / override / setup
middleware.ts     optional passcode gate
.github/workflows autonomous evaluate cron, every 15 min (GitHub Actions)
```
