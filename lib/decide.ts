// ---------------------------------------------------------------------------
// The decision engine — the heart of DynaMo.
//
// It is a PURE function: given one city's weather and any CMO override, it
// returns the single creative that should be live plus a plain-English reason.
// No database, no network, no clock — so it is trivially testable and easy to
// reason about out loud in review. Every non-obvious rule is commented with WHY.
// ---------------------------------------------------------------------------

export type CreativeCode = "CR-HOT" | "CR-RAIN" | "CR-NORM";

export type Weather = {
  tempC: number | null;
  precipMm: number | null;
  fetchedAt: string; // ISO timestamp of the reading
  stale: boolean; // older than the staleness window
  ok: boolean; // did the fetch succeed at all
};

export type Decision = {
  creative: CreativeCode; // the ONE creative that should be active in this city
  reason: string; // human sentence — shown to the CMO and written to the log
  confident: boolean; // false when we fell back for safety (drives the UI warning)
};

// Thresholds live in ONE place so (a) they are a single edit away and (b) the
// write-up can challenge them honestly:
//   - 35°C ignores humidity — 33°C in Chennai can feel worse than 36°C in Delhi.
//   - "> 0mm in the last hour" is a noisy definition — one drizzle flips the ad.
export const HOT_C = 35;
export const RAIN_MM = 0.2; // mm last hour; 0.2 filters sub-0.1mm trace/noise so a drizzle can't flip the ad
export const STALE_MINUTES = 15; // CoolSip's stated tolerance for stale data

export function decide(weather: Weather, opts?: { pin?: CreativeCode }): Decision {
  // 1) A manual pin from CoolSip always wins. Human override beats the machine —
  //    this is the CMO's escape hatch and the foundation of her trust.
  if (opts?.pin) {
    return {
      creative: opts.pin,
      reason: "Pinned by your team (manual override)",
      confident: true,
    };
  }

  // 2) Fail SAFE. If we could not read the weather, or the reading is too old to
  //    trust, we NEVER guess a weather-specific ad — showing "Beat the heat" in a
  //    downpour is exactly the brand damage the CMO fears. We fall back to the
  //    always-safe generic and flag low confidence so the dashboard can warn her.
  if (!weather.ok || weather.tempC === null) {
    return {
      creative: "CR-NORM",
      reason: "Weather unavailable — safe generic (Refresh anytime)",
      confident: false,
    };
  }
  if (weather.stale) {
    return {
      creative: "CR-NORM",
      reason: `Weather over ${STALE_MINUTES} min old — safe generic until it refreshes`,
      confident: false,
    };
  }
  // A valid temperature but a missing precipitation reading is also unsafe — we
  // cannot rule out rain, so we fall back rather than guess a weather-specific ad.
  if (weather.precipMm === null) {
    return {
      creative: "CR-NORM",
      reason: "Rain reading unavailable — safe generic",
      confident: false,
    };
  }

  // 3) Rain BEATS heat. Both can be true at once (a hot, wet monsoon afternoon).
  //    We resolve the tie toward the less embarrassing ad: an iced-drink ad in the
  //    rain is worse for the brand than a hot-drink ad in the heat, so wet wins.
  const raining = weather.precipMm > RAIN_MM;
  const hot = weather.tempC >= HOT_C;

  if (raining) {
    return {
      creative: "CR-RAIN",
      reason: `Raining now — ${weather.precipMm}mm last hour → Rainy day pick-me-up`,
      confident: true,
    };
  }
  if (hot) {
    return {
      creative: "CR-HOT",
      reason: `Hot — ${weather.tempC}°C, at or above ${HOT_C}°C → Beat the heat`,
      confident: true,
    };
  }
  // Distinguish genuinely dry from a sub-threshold trace, so a card showing
  // "0.1mm rain" never sits next to the word "dry" — a CMO would rightly question that.
  const reason =
    weather.precipMm > 0
      ? `Only a trace of rain (${weather.precipMm}mm, not over the ${RAIN_MM}mm mark) → Refresh anytime`
      : `Mild and dry — ${weather.tempC}°C → Refresh anytime`;
  return { creative: "CR-NORM", reason, confident: true };
}
