# DynaMo MVP — Design Spec & Build Plan

**Goal:** A working, deployed MVP of DynaMo — context-aware ad automation that flips CoolSip's 12 line items between three creatives based on live weather in 4 cities, logs every change with a reason, and gives the CMO a dashboard she can trust, monitor, and override.

**Architecture:** A single Next.js (App Router) app on Vercel, backed by serverless Postgres. One pure decision engine turns a city's weather + any CMO override into "which creative should be live, and why." A stateless evaluate loop fetches weather **per unique city** (not per line item), diffs desired-vs-current state, applies changes, and logs each transition. The dashboard reads straight from Postgres.

**Tech stack:** Next.js 14 · TypeScript · Postgres (Neon serverless) · Open-Meteo (no-key weather) · Vercel (host + cron).

---

## Global Constraints (from the brief — verbatim where it matters)

- **This is an MVP, NOT production-grade.** The brief: *"We do NOT care about production-grade code."* Over-investment is penalised: *"16+ hours = we designed it badly; we will not reward extra time."* → Build clean and robust; put production-grade *thinking* in the write-up, not gold-plating in the code.
- **Trust is requirement #1.** The system must never show a weather-specific ad it isn't sure about (no "Beat the heat" in a downpour). When uncertain → safe generic.
- **Visibility is requirement #2.** At any moment the CMO can see *what's running where and why*, recent changes, and can override.
- **Scale (discuss, don't build):** 10,000+ line items, 200+ cities. Weather calls ≈ $0.001 each, **$50/day cap**. Staleness tolerance **~15 min**.
- **Deliverables:** (1) deployed MVP with access for invited users, (2) write-up ≤3 pages, (3) 60-min walkthrough (they grill the *reasoning*).

---

## Data Model (Postgres)

Split by responsibility; each table has one job.

| Table | Purpose | Key columns |
|---|---|---|
| `line_items` | the unit of execution (seeded from `line_items.csv`) | `line_item_id` PK, `creative_id`, `creative_name`, `city`, `latitude`, `longitude`, `state` (`active`/`paused`), `bid_inr`, `daily_budget_inr` |
| `weather_cache` | one row per **city** — the dedup + staleness layer | `city` PK, `temp_c`, `precip_mm`, `fetched_at`, `ok` |
| `transitions` | append-only log — every state flip + **why** | `id` PK, `line_item_id`, `city`, `from_state`, `to_state`, `reason`, `created_at` |
| `controls` | CMO overrides | `scope` PK (`global` or a city), `hold` bool (freeze automation), `pin` (force a creative) |

**Why per-city `weather_cache`:** cost scales with *unique locations × refresh rate*, not line-item count — this table is the miniature of the $50 scale story. 12 line items → 4 cities → 4 calls, refreshed at most every 15 min.

**Why append-only `transitions`:** the CMO's "recent changes + reason" view, the audit trail, and the trust story are all the same table. Never updated, only inserted.

---

## Decision Engine (the heart — `lib/decide.ts`, already written)

Pure function `decide(weather, {pin}) -> {creative, reason, confident}`. Precedence, each rule commented with WHY:

1. **CMO pin wins.** Manual override beats the machine — her escape hatch.
2. **Fail safe.** Weather missing / API failed / reading older than 15 min → **CR-NORM (generic)** + `confident:false`. We never *guess* a weather-specific ad. This is the trust requirement in one branch.
3. **Rain beats heat.** Both can be true (hot wet monsoon). Iced-drink ad in rain is worse for the brand than hot-drink ad in heat → **wet wins ties.**
4. Else hot (`≥35°C`) → CR-HOT; else → CR-NORM.

Thresholds (`HOT_C=35`, `RAIN_MM=0`, `STALE_MINUTES=15`) are centralised and **challenged** in the write-up (35°C ignores humidity; "any drizzle" is noisy).

**Override precedence in the loop:** `global.hold` → freeze everything · `city.hold` → freeze that city · `city.pin` → force creative · else → `decide(weather)`.

---

## The Evaluate Loop (`/api/evaluate`)

Stateless, idempotent. Trigger-agnostic — safe to call as often as you like because the 15-min cache guards the API.

```
for each unique city:
  if weather_cache[city] older than 15 min (or missing): fetch Open-Meteo (4s timeout); upsert cache
  else: reuse cache
for each city:
  if global.hold or city.hold: skip (log nothing — state frozen)
  else:
    target = city.pin ?? decide(weather).creative
    for each line_item in city:
      desired = (creative_id == target) ? 'active' : 'paused'
      if state != desired: UPDATE state; INSERT transition(from,to,reason)
return summary { cities_fetched, api_calls, changes, errors }
```

**Trigger model (works on free Vercel Hobby):**
- **On dashboard load** — the loop runs on each view, cheap because of the 15-min cache → "when the CMO looks, it's fresh."
- **"Run now" button** — manual immediate eval.
- **Client poll** every ~3 min while the tab is open — live monitoring.
- **`vercel.json` cron** included (daily on Hobby, per-minute on Pro) as a heartbeat + to show the production pattern.
- *Production:* a real scheduler (Vercel Pro cron @ 10–15 min, or an external cron / queue worker). Called out as a tradeoff.

---

## Visibility Layer (`app/page.tsx`)

UI quality doesn't matter; clarity does. Components:
- **4 city cards:** temp, precip, data age (green/amber if stale), the live creative, the one-line *why*, and a low-confidence warning when we fell back.
- **Line-items table (12 rows):** state badge, creative, bid, budget, last-changed.
- **Change log:** newest transitions first — `LI-001 · Mumbai · paused→active · "Hot 36°C ≥ 35°C → Beat the heat" · 14:32`.
- **CMO controls:** global pause, per-city hold, per-city pin creative, clear, "Run now."

---

## Edge Cases (layered thinking — MVP behaviour + the fix)

| Edge case | MVP handles | How I'd fix for real |
|---|---|---|
| Weather API returns null/`ok:false` | fall to CR-NORM, `confident:false`, warn CMO | retry w/ backoff → last-known-good within window → generic; alert |
| API **times out** | 4s AbortController → treated as failure → generic | circuit breaker + per-provider fallback (OpenWeatherMap) |
| **Hot AND rainy** both true | rain wins (documented tie-break) | per-brand configurable tie policy |
| Data goes **stale** (>15 min) | flip to generic + amber age badge | adaptive refresh: volatile/active cities more often |
| Line item **mid-impression** when state flips | flip applies to *next* auction; in-flight impression completes | state is "eligible to serve," not "serving"; ad server owns the live auction |
| **All Mumbai paused** (CMO panic) | it can't happen — generic is the floor; one creative is always active per city | dashboard explainer + "why paused" on hover |
| Weather flaps around the threshold | *(known weakness — see write-up)* one drizzle flips the ad | hysteresis / debounce (require N min sustained) |

---

## Stretch — Multi-Trigger Abstraction

Weather is just one **Signal**. Generalise so a new trigger (cricket, stocks, AQI, traffic) needs a new *provider*, not a rewrite of the decision logic.

- **`Signal`** = `{ type, scope (city/national/custom), value, fetchedAt, ttl, ok }`. Weather, cricket, Nifty are all Signals.
- **`Rule`** = `{ creative, predicate(signals) -> bool, priority }`. Data, not code — stored per campaign.
- **`DecisionEngine`** evaluates the campaign's rules against the current signal snapshot, highest-priority match wins; falls to the generic. **Unchanged when a trigger is added.**
- **What stays the same across all triggers:** fetch→cache-by-scope→snapshot→evaluate-rules→diff→apply→log, plus fail-safe-to-generic.
- **What varies:** the provider (how you fetch), the scope granularity, the TTL/volatility, the predicate.
- **New failure modes:** (a) **conflicting signals** (cricket says India won → beer; stocks say crash → no beer) → an explicit per-campaign **conflict policy** (priority order, or "all must agree," or "safe wins"); (b) mixed staleness across signals; (c) partial-provider outage → evaluate on the healthy subset, degrade to generic if a *required* signal is missing.

---

## Deployment

- **Host:** Vercel (new project, free Hobby — unlimited projects, so the user's existing site is unaffected).
- **DB:** Neon serverless Postgres (free; separate from any existing project). `DATABASE_URL` env var.
- **Access for invited users:** a light shared-passcode gate on the dashboard (env `DASHBOARD_PASSCODE`) so it's not fully public but trivial to share. (Auth depth is a documented cut.)
- **Schema+seed:** idempotent `CREATE TABLE IF NOT EXISTS` + seed the 12 line items if empty, run via `/api/setup` (and on first evaluate).

---

## Deliberate Cuts (the tradeoffs — articulated, not accidental)

1. **No real auth / RBAC** — a shared passcode, not per-user login. Chosen: ship visibility fast; a demo doesn't need identity. Would add for prod.
2. **No budget pacing / bid logic** — `bid`/`daily_budget` are stored + shown but not spent against. Chosen: the brief's core loop is weather→state; pacing is a whole subsystem. Would add a spend tracker + auto-pause on budget exhaustion.
3. **Sub-daily automation not on Hobby cron** — load/poll/manual + daily cron. Chosen: works free; a real scheduler is a config change. Would use Pro cron / a worker.

## What I'd Add For Production (the write-up's "thinking" section)

Retries + circuit breaker + provider fallback · per-city adaptive refresh · hysteresis on thresholds · real auth + audit-by-user · budget pacing · the Signal/Rule engine + conflict policy · alerting on stale/failed cities · idempotency keys + a proper job queue at scale · tests around the decision engine + loop.

---

## Build Plan (phases — inline execution this session)

- [x] **P0 — Foundation:** package.json, tsconfig, next config, `lib/decide.ts`, `lib/weather.ts`. *(done)*
- [ ] **P1 — Data layer:** `lib/db.ts` (Neon client, schema, seed, typed queries). Deliverable: tables + 12 seeded rows.
- [ ] **P2 — Core loop:** `app/api/evaluate/route.ts` + `app/api/setup/route.ts`. Deliverable: one call fetches weather, flips states, logs transitions.
- [ ] **P3 — Decision test:** `lib/decide.test.ts` — the engine is the heart, so it gets real tests (pin wins, fail-safe, rain>heat, thresholds). Deliverable: green tests, run with `node --test`.
- [ ] **P4 — Dashboard:** `app/page.tsx` + `app/globals.css` + control components + `app/api/override/route.ts`. Deliverable: CMO can see + override.
- [ ] **P5 — Cron + access:** `vercel.json` cron, passcode gate, `.env.example`. 
- [ ] **P6 — Deploy:** Neon DB + Vercel, live URL, smoke test.
- [ ] **P7 — Docs:** `WRITEUP.md` (≤3pp) + `CHEATSHEET.md` (defend every decision in the call) + `README.md`.
