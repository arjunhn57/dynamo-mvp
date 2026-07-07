import { neon } from "@neondatabase/serverless";
import type { CreativeCode } from "./decide";

// ---------------------------------------------------------------------------
// Data layer. One place for the schema, the seed, and every typed query.
// Postgres via Neon's serverless (HTTP) driver — no connection pool to manage,
// which is exactly right for Vercel's serverless functions.
// ---------------------------------------------------------------------------

// Fallback keeps `next build` from crashing when DATABASE_URL is absent at build
// time — real queries only run at request time (pages are force-dynamic), where a
// missing/invalid URL surfaces as a caught, friendly "not configured yet" message.
export const sql = neon(
  process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    "postgres://placeholder:placeholder@placeholder/placeholder",
);

export type LineItem = {
  line_item_id: string;
  creative_id: CreativeCode;
  creative_name: string;
  city: string;
  latitude: number;
  longitude: number;
  state: "active" | "paused";
  bid_inr: number;
  daily_budget_inr: number;
};

export type WeatherRow = {
  city: string;
  temp_c: number | null;
  precip_mm: number | null;
  fetched_at: string;
  ok: boolean;
};

export type Transition = {
  id: number;
  line_item_id: string;
  city: string;
  from_state: string;
  to_state: string;
  reason: string;
  created_at: string;
};

export type Controls = {
  global: { hold: boolean };
  byCity: Record<string, { hold: boolean; pin: CreativeCode | null }>;
};

// The 12 starter line items — copied from the provided line_items.csv, which is
// the source of truth for the seed.
const SEED: LineItem[] = [
  { line_item_id: "LI-001", creative_id: "CR-HOT",  creative_name: "Beat the heat",        city: "Mumbai",    latitude: 19.076,  longitude: 72.8777, state: "paused", bid_inr: 12.5, daily_budget_inr: 5000 },
  { line_item_id: "LI-002", creative_id: "CR-RAIN", creative_name: "Rainy day pick-me-up", city: "Mumbai",    latitude: 19.076,  longitude: 72.8777, state: "paused", bid_inr: 11.0, daily_budget_inr: 5000 },
  { line_item_id: "LI-003", creative_id: "CR-NORM", creative_name: "Refresh anytime",      city: "Mumbai",    latitude: 19.076,  longitude: 72.8777, state: "active", bid_inr: 9.0,  daily_budget_inr: 5000 },
  { line_item_id: "LI-004", creative_id: "CR-HOT",  creative_name: "Beat the heat",        city: "Delhi",     latitude: 28.6139, longitude: 77.209,  state: "active", bid_inr: 13.0, daily_budget_inr: 6000 },
  { line_item_id: "LI-005", creative_id: "CR-RAIN", creative_name: "Rainy day pick-me-up", city: "Delhi",     latitude: 28.6139, longitude: 77.209,  state: "paused", bid_inr: 11.5, daily_budget_inr: 6000 },
  { line_item_id: "LI-006", creative_id: "CR-NORM", creative_name: "Refresh anytime",      city: "Delhi",     latitude: 28.6139, longitude: 77.209,  state: "paused", bid_inr: 9.5,  daily_budget_inr: 6000 },
  { line_item_id: "LI-007", creative_id: "CR-HOT",  creative_name: "Beat the heat",        city: "Bangalore", latitude: 12.9716, longitude: 77.5946, state: "paused", bid_inr: 12.0, daily_budget_inr: 4500 },
  { line_item_id: "LI-008", creative_id: "CR-RAIN", creative_name: "Rainy day pick-me-up", city: "Bangalore", latitude: 12.9716, longitude: 77.5946, state: "paused", bid_inr: 11.0, daily_budget_inr: 4500 },
  { line_item_id: "LI-009", creative_id: "CR-NORM", creative_name: "Refresh anytime",      city: "Bangalore", latitude: 12.9716, longitude: 77.5946, state: "active", bid_inr: 9.0,  daily_budget_inr: 4500 },
  { line_item_id: "LI-010", creative_id: "CR-HOT",  creative_name: "Beat the heat",        city: "Chennai",   latitude: 13.0827, longitude: 80.2707, state: "active", bid_inr: 12.5, daily_budget_inr: 5500 },
  { line_item_id: "LI-011", creative_id: "CR-RAIN", creative_name: "Rainy day pick-me-up", city: "Chennai",   latitude: 13.0827, longitude: 80.2707, state: "paused", bid_inr: 11.0, daily_budget_inr: 5500 },
  { line_item_id: "LI-012", creative_id: "CR-NORM", creative_name: "Refresh anytime",      city: "Chennai",   latitude: 13.0827, longitude: 80.2707, state: "paused", bid_inr: 9.0,  daily_budget_inr: 5500 },
];

// Idempotent: safe to call on every request. Creates tables if absent, seeds the
// 12 line items only when the table is empty, and guarantees the global control row.
let schemaReady = false;

export async function initSchema(): Promise<void> {
  if (schemaReady) return; // warm instance: skip the create + seed round-trips
  await sql`CREATE TABLE IF NOT EXISTS line_items (
    line_item_id TEXT PRIMARY KEY,
    creative_id TEXT NOT NULL,
    creative_name TEXT NOT NULL,
    city TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('active','paused')),
    bid_inr DOUBLE PRECISION NOT NULL,
    daily_budget_inr INTEGER NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS weather_cache (
    city TEXT PRIMARY KEY,
    temp_c DOUBLE PRECISION,
    precip_mm DOUBLE PRECISION,
    fetched_at TIMESTAMPTZ NOT NULL,
    ok BOOLEAN NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS transitions (
    id SERIAL PRIMARY KEY,
    line_item_id TEXT NOT NULL,
    city TEXT NOT NULL,
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS controls (
    scope TEXT PRIMARY KEY,
    hold BOOLEAN NOT NULL DEFAULT false,
    pin TEXT
  )`;

  const rows = (await sql`SELECT COUNT(*)::int AS count FROM line_items`) as { count: number }[];
  if (rows[0].count < SEED.length) {
    // ON CONFLICT keeps this concurrency-safe: under a stale/replica read the count
    // can look low and re-trigger the seed — the inserts then no-op instead of
    // throwing duplicate-key, and a partial seed self-heals to the full 12.
    for (const li of SEED) {
      await sql`INSERT INTO line_items
        (line_item_id, creative_id, creative_name, city, latitude, longitude, state, bid_inr, daily_budget_inr)
        VALUES (${li.line_item_id}, ${li.creative_id}, ${li.creative_name}, ${li.city},
                ${li.latitude}, ${li.longitude}, ${li.state}, ${li.bid_inr}, ${li.daily_budget_inr})
        ON CONFLICT (line_item_id) DO NOTHING`;
    }
  }
  await sql`INSERT INTO controls (scope, hold, pin) VALUES ('global', false, NULL) ON CONFLICT (scope) DO NOTHING`;
  schemaReady = true;
}

export async function getLineItems(): Promise<LineItem[]> {
  return (await sql`SELECT * FROM line_items ORDER BY line_item_id`) as LineItem[];
}

export async function getWeatherCache(): Promise<Record<string, WeatherRow>> {
  const rows = (await sql`SELECT city, temp_c, precip_mm, fetched_at::text, ok FROM weather_cache`) as WeatherRow[];
  return Object.fromEntries(rows.map((r) => [r.city, r]));
}

export async function upsertWeather(
  city: string,
  temp_c: number | null,
  precip_mm: number | null,
  fetchedAtIso: string,
  ok: boolean,
): Promise<void> {
  await sql`INSERT INTO weather_cache (city, temp_c, precip_mm, fetched_at, ok)
    VALUES (${city}, ${temp_c}, ${precip_mm}, ${fetchedAtIso}, ${ok})
    ON CONFLICT (city) DO UPDATE
    SET temp_c = EXCLUDED.temp_c, precip_mm = EXCLUDED.precip_mm,
        fetched_at = EXCLUDED.fetched_at, ok = EXCLUDED.ok`;
}

// Conditional update: writes (and reports true) only when the state actually
// changes. Postgres row-locking serialises concurrent evaluate runs, so of two
// racing runs exactly one flips a given line item — the other matches zero rows.
// That keeps the transition log free of duplicate / no-op entries.
export async function setLineItemState(id: string, state: "active" | "paused"): Promise<boolean> {
  const rows = (await sql`UPDATE line_items SET state = ${state}
    WHERE line_item_id = ${id} AND state <> ${state}
    RETURNING line_item_id`) as { line_item_id: string }[];
  return rows.length > 0;
}

export async function insertTransition(
  t: Omit<Transition, "id" | "created_at">,
): Promise<void> {
  await sql`INSERT INTO transitions (line_item_id, city, from_state, to_state, reason)
    VALUES (${t.line_item_id}, ${t.city}, ${t.from_state}, ${t.to_state}, ${t.reason})`;
}

export async function getTransitions(limit = 30): Promise<Transition[]> {
  return (await sql`SELECT id, line_item_id, city, from_state, to_state, reason, created_at::text
    FROM transitions ORDER BY id DESC LIMIT ${limit}`) as Transition[];
}

export async function getControls(): Promise<Controls> {
  const rows = (await sql`SELECT scope, hold, pin FROM controls`) as {
    scope: string;
    hold: boolean;
    pin: CreativeCode | null;
  }[];
  const controls: Controls = { global: { hold: false }, byCity: {} };
  for (const r of rows) {
    if (r.scope === "global") controls.global.hold = r.hold;
    else controls.byCity[r.scope] = { hold: r.hold, pin: r.pin };
  }
  return controls;
}

export async function setControl(
  scope: string,
  hold: boolean,
  pin: CreativeCode | null,
): Promise<void> {
  await sql`INSERT INTO controls (scope, hold, pin) VALUES (${scope}, ${hold}, ${pin})
    ON CONFLICT (scope) DO UPDATE SET hold = EXCLUDED.hold, pin = EXCLUDED.pin`;
}
