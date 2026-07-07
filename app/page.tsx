import { runEvaluation } from "@/lib/evaluate";
import { getLineItems, getWeatherCache, getControls, getTransitions } from "@/lib/db";
import { decide, type Weather } from "@/lib/decide";
import { isStale } from "@/lib/weather";
import { Controls } from "./Controls";

export const dynamic = "force-dynamic";

type Cond = "hot" | "rain" | "normal" | "held";

function WxIcon({ cond }: { cond: Cond }) {
  if (cond === "hot")
    return (
      <svg className="icon" aria-hidden="true" viewBox="0 0 32 32" fill="none" stroke="#d96f0a" strokeWidth="2" strokeLinecap="round">
        <circle cx="16" cy="16" r="5.5" fill="#d96f0a" stroke="none" />
        <path d="M16 3.5v3.5M16 25v3.5M3.5 16h3.5M25 16h3.5M7.2 7.2l2.4 2.4M22.4 22.4l2.4 2.4M24.8 7.2l-2.4 2.4M9.6 22.4l-2.4 2.4" />
      </svg>
    );
  if (cond === "rain")
    return (
      <svg className="icon" aria-hidden="true" viewBox="0 0 32 32" fill="none">
        <path d="M9.5 18a5 5 0 0 1 .6-9.96A6.5 6.5 0 0 1 22.5 9.4a4.5 4.5 0 0 1 1 8.6H9.5z" fill="#c7ddf2" stroke="#2778bf" strokeWidth="1.6" />
        <path d="M11.5 21.5l-1.5 3.5M16.5 21.5l-1.5 3.5M21.5 21.5l-1.5 3.5" stroke="#2778bf" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  if (cond === "held")
    return (
      <svg className="icon" aria-hidden="true" viewBox="0 0 32 32" fill="none" stroke="#79839a" strokeWidth="2" strokeLinecap="round">
        <rect x="9" y="15" width="14" height="10" rx="2" fill="#e4e9f0" />
        <path d="M12 15v-3a4 4 0 0 1 8 0v3" />
      </svg>
    );
  return (
    <svg className="icon" aria-hidden="true" viewBox="0 0 32 32" fill="none">
      <circle cx="12" cy="12" r="4.5" fill="#e6b34a" />
      <path d="M12.5 22a4.5 4.5 0 0 1 .4-8.98A5.9 5.9 0 0 1 23.5 13.5a4 4 0 0 1 .5 8.5H12.5z" fill="#e2ece5" stroke="#4a8a68" strokeWidth="1.6" />
    </svg>
  );
}

function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="12" cy="13" r="5" fill="#f0a83a" />
      <path d="M22 16c-2.4 2.6-2.4 6 0 7 2.4-1 2.4-4.4 0-7z" fill="#4aa3e6" />
    </svg>
  );
}

const CREATIVE_COND: Record<string, Cond> = { "CR-HOT": "hot", "CR-RAIN": "rain", "CR-NORM": "normal" };

// Format on a fixed IST clock + label it — server (Vercel) runs UTC, and the
// freshness stamp is the dashboard's core trust cue, so it must read in the
// CMO's timezone regardless of where the function runs.
const IST_TIME: Intl.DateTimeFormatOptions = { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" };
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", IST_TIME) + " IST";

export default async function Page() {
  let ranAt: string | null = null;
  let setupError: string | null = null;
  try {
    ranAt = (await runEvaluation()).ran_at;
  } catch (e) {
    console.error("dashboard evaluation failed", e);
    setupError = "Couldn't reach the database.";
  }

  if (setupError) {
    return (
      <main className="wrap">
        <h1 className="wordmark">DynaMo</h1>
        <div className="errcard">
          <b>Not configured yet.</b>
          <p className="dim">{setupError}</p>
          <p>
            Set <code>DATABASE_URL</code>, then open <code>/api/setup</code> once to create the
            tables and seed the 12 line items.
          </p>
        </div>
      </main>
    );
  }

  const [items, cache, controls, transitions] = await Promise.all([
    getLineItems(),
    getWeatherCache(),
    getControls(),
    getTransitions(25),
  ]);

  const cities = [...new Set(items.map((i) => i.city))];
  const view = cities.map((city) => {
    const c = cache[city];
    const weather: Weather = c
      ? { tempC: c.temp_c, precipMm: c.precip_mm, fetchedAt: c.fetched_at, ok: c.ok, stale: c.ok ? isStale(c.fetched_at) : false }
      : { tempC: null, precipMm: null, fetchedAt: new Date().toISOString(), ok: false, stale: false };
    const held = controls.global.hold || (controls.byCity[city]?.hold ?? false);
    const pin = controls.byCity[city]?.pin ?? null;
    const active = items.find((i) => i.city === city && i.state === "active");
    let reason: string;
    let confident = true;
    if (held) {
      reason = "On hold — automation paused by your team";
    } else {
      const d = decide(weather, { pin: pin ?? undefined });
      reason = d.reason;
      confident = d.confident;
    }
    const cond: Cond = held ? "held" : active ? CREATIVE_COND[active.creative_id] : "normal";
    const ageMin = c ? Math.round((Date.now() - new Date(c.fetched_at).getTime()) / 60000) : null;
    return { city, weather, held, pin, active, reason, confident, cond, ageMin, warn: weather.stale || !weather.ok };
  });

  const activeCount = items.filter((i) => i.state === "active").length;

  return (
    <main className="wrap">
      <header className="masthead">
        <div className="brand">
          <span className="brandmark">
            <BrandMark />
          </span>
          <div>
            <h1 className="wordmark">DynaMo</h1>
            <div className="tagline">CoolSip · summer campaign</div>
          </div>
        </div>
        <div className="mast-right">
          <span className="livechip">
            <span className="dot" /> LIVE · evaluated {ranAt ? fmtTime(ranAt) : "—"}
          </span>
          <div className="summary">
            {activeCount}/{items.length} line items active across {cities.length} cities
          </div>
        </div>
      </header>

      {controls.global.hold && (
        <div className="banner">⏸ Automation is on hold — creatives stay as they are until you resume.</div>
      )}

      <Controls cities={cities} global={controls.global} byCity={controls.byCity} />

      <h2 className="sec-title">Cities · live decision per city</h2>
      <section className="cities">
        {view.map((v) => (
          <div key={v.city} className={`city ${v.cond}`}>
            <div className="toprow">
              <div>
                <h3 className="name">{v.city}</h3>
                {(v.held || v.pin) && (
                  <div className="tags">
                    {v.held && <span className="tag held">HELD</span>}
                    {v.pin && <span className="tag pin">PINNED</span>}
                  </div>
                )}
              </div>
              <WxIcon cond={v.cond} />
            </div>
            <div className="temp">
              {v.weather.tempC ?? "—"}
              <small>°C</small>
            </div>
            <div className="subwx">{v.weather.precipMm ?? "—"} mm rain · last hour</div>
            <div className={"age" + (v.warn ? " warn" : "")}>{v.ageMin != null ? `updated ${v.ageMin}m ago` : "no reading"}{v.weather.stale && " · stale"}{!v.weather.ok && " · weather check failed"}</div>
            <div className="creative">
              <span className="swatch" />
              {v.active ? v.active.creative_name : "—"}
            </div>
            <div className="why">{v.reason}</div>
            {!v.confident && !v.held && <div className="flag">⚠ Low confidence — showing the safe generic ad.</div>}
          </div>
        ))}
      </section>

      <h2 className="sec-title">Line items · {items.length}</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>City</th>
              <th>Creative</th>
              <th>State</th>
              <th>Bid (₹)</th>
              <th>Daily budget (₹)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.line_item_id}>
                <td className="mono">{i.line_item_id}</td>
                <td>{i.city}</td>
                <td>{i.creative_name}</td>
                <td>
                  <span className={"pill " + i.state}>{i.state}</span>
                </td>
                <td className="mono">{i.bid_inr}</td>
                <td className="mono">{i.daily_budget_inr.toLocaleString("en-IN")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="sec-title">Recent changes · what flipped and why</h2>
      <div className="log">
        {transitions.length === 0 && (
          <div className="empty">No changes yet — every line item is still in its starting state.</div>
        )}
        {transitions.map((t) => (
          <div className="logrow" key={t.id}>
            <span className="time">{fmtTime(t.created_at)}</span>
            <span className="lid">{t.line_item_id}</span>
            <span className="dim">{t.city}</span>
            <span className="to">
              {t.from_state} → {t.to_state}
            </span>
            <span className="rsn">{t.reason}</span>
          </div>
        ))}
      </div>

      <footer>DynaMo MVP · weather via Open-Meteo · design + decision engine, scale &amp; abstraction notes in SPEC.md</footer>
    </main>
  );
}
