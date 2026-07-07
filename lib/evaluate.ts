import { decide, type Weather } from "./decide";
import { fetchWeather, isStale } from "./weather";
import {
  initSchema,
  getLineItems,
  getWeatherCache,
  upsertWeather,
  setLineItemState,
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
export async function runEvaluation(): Promise<EvalResult> {
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
      if (c && c.ok && !isStale(c.fetched_at)) {
        const w: Weather = {
          tempC: c.temp_c,
          precipMm: c.precip_mm,
          fetchedAt: c.fetched_at,
          stale: false,
          ok: true,
        };
        return { city, w, fetched: false };
      }
      const w = await fetchWeather(loc.lat, loc.lon);
      try {
        await upsertWeather(city, w.tempC, w.precipMm, w.fetchedAt, w.ok);
      } catch (e) {
        // One city's cache-write blip must not fail the whole run — use the
        // in-memory reading and carry on.
        console.error("weather cache write failed for", city, e);
      }
      return { city, w, fetched: true };
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

    for (const li of lineItems) {
      if (li.city !== city) continue;
      const desired = li.creative_id === d.creative ? "active" : "paused";
      if (li.state !== desired) {
        const changed = await setLineItemState(li.line_item_id, desired);
        if (changed) {
          await insertTransition({
            line_item_id: li.line_item_id,
            city,
            from_state: li.state,
            to_state: desired,
            reason: d.reason,
          });
          changes.push({ line_item_id: li.line_item_id, city, to: desired, reason: d.reason });
        }
      }
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
