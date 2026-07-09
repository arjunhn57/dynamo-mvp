import { decide, type Weather } from "./decide";
import { fetchWeather, isStale } from "./weather";
import {
  initSchema,
  getLineItems,
  getWeatherCache,
  upsertWeather,
  applyCityDecision,
  insertTransition,
  getControls,
} from "./db";

export type EvalResult = {
  ok: true;
  ran_at: string;
  cities: number;
  api_calls: number;
  changes: { line_item_id: string; city: string; to: string; reason: string }[];
};

// The core loop. Idempotent and trigger-agnostic: the dashboard load, the
// "Run now" button, the client poll, and the cron all call this. The 15-minute
// per-city weather cache is what makes calling it often both safe and cheap.
export async function runEvaluation(opts?: { failWeather?: boolean }): Promise<EvalResult> {
  // Demo switch (?failWeather=1): make the provider look offline so the fail-safe
  // can be shown on demand. It must also bypass the cache — a fresh per-city
  // reading would otherwise mask even a real outage for a full 15 minutes.
  const failWeather = opts?.failWeather === true;
  await initSchema();
  const [lineItems, cache, controls] = await Promise.all([
    getLineItems(),
    getWeatherCache(),
    getControls(),
  ]);

  // Dedup to unique cities — weather cost scales with LOCATIONS, not line items.
  const cities = new Map<string, { lat: number; lon: number }>();
  for (const li of lineItems) {
    if (!cities.has(li.city)) cities.set(li.city, { lat: li.latitude, lon: li.longitude });
  }

  // 1) Refresh weather per city — in parallel, and only when the cache is stale.
  const refreshed = await Promise.all(
    [...cities.entries()].map(async ([city, loc]) => {
      const c = cache[city];
      if (!failWeather && c && c.ok && c.temp_c !== null && !isStale(c.fetched_at)) {
        const w: Weather = {
          tempC: c.temp_c,
          precipMm: c.precip_mm,
          fetchedAt: c.fetched_at,
          stale: false,
          ok: true,
        };
        return { city, w, fetched: false };
      }
      const w: Weather = failWeather
        ? { tempC: null, precipMm: null, fetchedAt: new Date().toISOString(), stale: false, ok: false }
        : await fetchWeather(loc.lat, loc.lon);
      try {
        // The demo switch must never corrupt the real cache — skip the write so a
        // normal reload recovers immediately from the last good reading.
        if (!failWeather) await upsertWeather(city, w.tempC, w.precipMm, w.fetchedAt, w.ok);
      } catch (e) {
        // One city's cache-write blip must not fail the whole run — use the
        // in-memory reading and carry on.
        console.error("weather cache write failed for", city, e);
      }
      // In the forced-failure demo no request leaves the server, so it is not an API call.
      return { city, w, fetched: !failWeather };
    }),
  );
  const apiCalls = refreshed.filter((r) => r.fetched).length;
  const weatherByCity: Record<string, Weather> = {};
  for (const r of refreshed) weatherByCity[r.city] = r.w;

  // 2) Decide + apply per city, honoring CMO overrides. Write only on real change.
  const changes: EvalResult["changes"] = [];
  for (const city of cities.keys()) {
    if (controls.global.hold || controls.byCity[city]?.hold) continue; // frozen by CMO
    const pin = controls.byCity[city]?.pin ?? undefined;
    const w = weatherByCity[city];
    const weather: Weather = { ...w, stale: w.ok ? isStale(w.fetchedAt) : false };
    const d = decide(weather, { pin });

    // One atomic statement flips the whole city; RETURNING gives just the real changes to log.
    const flipped = await applyCityDecision(city, d.creative);
    for (const row of flipped) {
      const from_state = row.state === "active" ? "paused" : "active";
      await insertTransition({ line_item_id: row.line_item_id, city, from_state, to_state: row.state, reason: d.reason });
      changes.push({ line_item_id: row.line_item_id, city, to: row.state, reason: d.reason });
    }
  }

  return {
    ok: true,
    ran_at: new Date().toISOString(),
    cities: cities.size,
    api_calls: apiCalls,
    changes,
  };
}
