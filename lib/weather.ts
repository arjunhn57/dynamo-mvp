import { STALE_MINUTES, type Weather } from "./decide";

// ---------------------------------------------------------------------------
// Weather provider: Open-Meteo.
//
// Chosen for the MVP because it needs NO API key (zero setup friction), returns
// exactly the two fields the decision needs (current temperature + precipitation),
// and is free for prototyping. The whole provider is isolated behind this one
// function, so swapping to OpenWeatherMap — or to a completely different signal
// like cricket scores — is a one-file change (see the abstraction in README.md).
// ---------------------------------------------------------------------------

export async function fetchWeather(
  lat: number,
  lon: number,
  timeoutMs = 4000,
): Promise<Weather> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,precipitation&timezone=auto`;

  // A hard timeout: a slow weather API must never hang the whole loop. If it
  // times out we return ok:false and the engine falls back to the safe generic.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const j = await res.json();
    const cur = j?.current ?? {};
    return {
      tempC: typeof cur.temperature_2m === "number" ? cur.temperature_2m : null,
      precipMm: typeof cur.precipitation === "number" ? cur.precipitation : null,
      fetchedAt: new Date().toISOString(),
      stale: false,
      ok: true,
    };
  } catch (err) {
    console.error("Open-Meteo fetch failed", err);
    return {
      tempC: null,
      precipMm: null,
      fetchedAt: new Date().toISOString(),
      stale: false,
      ok: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function isStale(fetchedAt: string): boolean {
  return Date.now() - new Date(fetchedAt).getTime() > STALE_MINUTES * 60_000;
}
