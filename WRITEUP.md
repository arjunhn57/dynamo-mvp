# DynaMo MVP — Write-up

**Arjun H N** · Live: **https://dynamo-murex.vercel.app** · Code + SPEC.md in the repo.

*Access note: the URL is unlisted for the demo. A one-env-var HTTP Basic Auth gate (`middleware.ts`, `DASHBOARD_PASSCODE`) can lock it to a shared passcode — left off so you can click straight in.*

---

## What I built & why

**Data model — four tables, split by responsibility.** `line_items` is the unit of execution (seeded from your CSV). `weather_cache` holds one row **per city, not per line item** — because weather cost scales with *unique locations*, not campaign size — so 200 cities refreshed every 15 min is 200 × 96/day × $0.001 ≈ **$19.20/day, well under the $50 cap**, and 10k or 100k line items cost exactly the same. This table is the whole scale story in miniature. `transitions` is an **append-only log** — every state flip with its reason — which is simultaneously the audit trail, the CMO's "recent changes" feed, and the trust artifact, so it's never mutated. `controls` stores CMO overrides (global freeze, per-city hold, per-city pin). One job each.

**Tech choices — deliberately boring.** Next.js on Vercel gives me a dashboard, API routes, and a scheduler in one deploy. Postgres (Neon serverless) is the right shape for "a database of line items + a log," and the serverless driver means no connection pool to babysit inside Vercel functions. Open-Meteo needs **no API key** (zero setup friction) and returns exactly the two fields the decision needs — temperature and precipitation. It's isolated behind one function, so swapping to OpenWeatherMap, or swapping *weather itself* for cricket scores, is a one-file change.

**Decision logic — one pure function.** `decide(weather, override) -> {creative, reason, confident}`. Precedence, each rule chosen on purpose: (1) a **CMO pin always wins** — her manual escape hatch and the root of her trust; (2) **fail safe** — if the weather is missing or older than 15 minutes, I never *guess* a weather-specific ad, I fall to the generic and flag low confidence — this is requirement #1 ("trust") expressed as a single branch; (3) **rain beats heat** on ties, because an iced-drink ad in a downpour is worse for the brand than a hot-drink ad in the heat. Being a pure function, it's trivially testable (8 unit tests) and easy to defend out loud. One deliberate simplification: thresholds are global — but *Mumbai-rainy and Bangalore-rainy aren't really the same* (2 mm is an ordinary coastal-monsoon afternoon in Mumbai, a notable event in drier Bangalore), so a per-city rain threshold is the obvious next step — and because "rain" is just a Signal with a per-location scope, that's config, not a logic change. Same lens on "hot": I use raw temperature, but 35°C in humid Chennai isn't 35°C in dry Delhi, so `apparent_temperature` (feels-like, also from Open-Meteo) is the honest upgrade — one field away.

**Visibility layer — built for the CMO.** The dashboard evaluates on load (always fresh, kept cheap by the cache) and shows, per city: live weather + data age, the creative currently running, and the plain-English **why**. Below that: the full line-item table, an append-only **change log** (`LI-002 · Mumbai · paused→active · "Raining now — 0.4mm → Rainy day pick-me-up" · 2:19 pm IST`), and **CMO controls** — freeze-automation, per-city hold, per-city pin, and Run-now. See, trust, override: the three things her brief asked for.

## Three tradeoffs I made

1. **No real auth — a shared passcode, not per-user login.** Chose to ship visibility fast; a demo doesn't need identity. Prod: SSO + per-user audit (who overrode what, when).
2. **No budget pacing.** `bid` and `daily_budget` are stored and shown but not spent against. The brief's core loop is weather→state; pacing is a whole subsystem. Prod: a spend tracker that auto-pauses a line item on budget exhaustion — and I'd note that **budget, not weather, is the *other* reason a line item should pause**, which the model should treat as a first-class cause.
3. **Automation cadence on free Vercel.** Hobby caps cron at daily, so live freshness comes from evaluate-on-load + an on-by-default 3-minute client poll + Run-now; the daily cron is only a heartbeat. Prod: a 15-minute cron (Pro), or a proper job queue at 200-city scale.

## Three edge cases my MVP handles badly (and the fix)

1. **Threshold flapping.** I ship a 0.2 mm floor so trace drizzle doesn't count as rain, but weather sitting exactly on a boundary (34.9 / 35.1°C) can still flip the creative every cycle — churny, and to the CMO it looks broken. **Fix:** hysteresis — flip to Hot at ≥35°C but back only below 34°C, or require the condition to hold N minutes before reverting.
2. **A failed refetch discards the last good reading.** At the 15-minute refresh boundary a *failed* refetch overwrites the cached reading with a failure marker, so the city drops to the generic even though it had valid data moments earlier. **Fix:** on a failed refetch, keep the last-known-good row within a short grace window instead of overwriting it, and only fall to the generic once it's genuinely stale.
3. **Mid-impression / in-flight state.** I flip a DB flag, but a real ad server has auctions in flight — "state" here means "eligible to serve next," not "serving right now." **Fix:** make that boundary explicit; treat the flip as eventually-consistent and let the ad server finish any in-flight impression rather than yanking a creative mid-delivery.

## Stretch — an any-signal abstraction

Weather is just one **Signal**: `{ type, scope, value, fetchedAt, ttl, ok }`. Cricket scores, Nifty moves, AQI, traffic are all Signals with the same shape. A **Rule** is *data, not code*: `{ creative, predicate(signals) -> bool, priority }`, stored per campaign. Rules being *data* implies an author — a lightweight config surface for CoolSip's ops team, so a new campaign or trigger is a form entry, not an engineering ticket. The **DecisionEngine** evaluates a campaign's rules against the current signal snapshot — highest-priority match wins, else the generic. **Adding a trigger means adding a provider and registering rules; the engine never changes.**

- **What stays the same across every trigger:** fetch → cache-by-scope → snapshot → evaluate-rules → diff → apply → log, plus fail-safe-to-generic.
- **What varies:** the provider (how you fetch), the scope granularity (city vs national vs custom), the TTL/volatility, and the predicate.
- **New failure modes multi-trigger introduces:** (a) **conflicting signals** — cricket says India won (→ beer) while stocks say the market crashed (→ don't). This needs an explicit per-campaign **conflict policy**: priority order, "all must agree," or "safe wins." My default is *safe wins* — the beer ad does **not** run on conflict, because the CMO's downside is asymmetric (a tone-deaf ad during a crash costs more than a missed beer impression). (b) **Mixed staleness** — one signal fresh, another stale; the freshest-required-signal rule gates the decision. (c) **Partial-provider outage** — evaluate on the healthy subset, and degrade to the generic only if a *required* signal is missing.

## What I'd add for production (the part the MVP deliberately skips)

Retries + circuit breaker + a fallback weather provider · last-known-good reuse · per-city adaptive refresh (poll volatile/active cities more often to stretch the $50) · hysteresis on thresholds · real auth + per-user audit · budget pacing · the Signal/Rule engine + conflict policy · alerting when a city goes stale or a fetch fails · idempotency keys + a job queue at scale. *(Next.js is already pinned to the patched 14.2.35.)*
