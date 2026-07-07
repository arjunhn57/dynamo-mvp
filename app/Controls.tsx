"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { CreativeCode } from "@/lib/decide";

type Props = {
  cities: string[];
  global: { hold: boolean };
  byCity: Record<string, { hold: boolean; pin: CreativeCode | null }>;
};

const PINS: { code: CreativeCode; label: string; cls: string }[] = [
  { code: "CR-HOT", label: "Hot", cls: "chip-hot" },
  { code: "CR-RAIN", label: "Rain", cls: "chip-rain" },
  { code: "CR-NORM", label: "Generic", cls: "chip-norm" },
];

export function Controls({ cities, global, byCity }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => void run(), 180_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/evaluate", { cache: "no-store" });
      if (!res.ok) throw new Error("Evaluation failed — try again");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function override(scope: string, hold: boolean, pin: CreativeCode | null) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/override", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope, hold, pin }),
      });
      if (!res.ok) throw new Error("That change did not save — try again");
      await fetch("/api/evaluate", { cache: "no-store" });
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="controls">
      <div className="ctrow">
        <button className="primary" onClick={run} disabled={busy}>
          {busy ? "Working…" : "Run now"}
        </button>
        <label className="switch">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Auto-run every 3 min
        </label>
        {err && <span className="err-inline">{err}</span>}
        <span className="spacer" />
        {global.hold ? (
          <button onClick={() => override("global", false, null)} disabled={busy}>
            ▶ Resume automation
          </button>
        ) : (
          <button onClick={() => override("global", true, null)} disabled={busy}>
            ⏸ Freeze automation
          </button>
        )}
      </div>

      {cities.map((city) => {
        const c = byCity[city] ?? { hold: false, pin: null };
        const isAuto = !c.hold && !c.pin;
        return (
          <div className="ctrow" key={city}>
            <span className="cty">{city}</span>
            <button className={isAuto ? "on" : ""} onClick={() => override(city, false, null)} disabled={busy}>
              Auto
            </button>
            <button className={c.hold ? "on" : ""} onClick={() => override(city, true, null)} disabled={busy}>
              Hold
            </button>
            <span className="dim">pin</span>
            {PINS.map((p) => (
              <button
                key={p.code}
                className={`${p.cls}${c.pin === p.code ? " on" : ""}`}
                onClick={() => override(city, false, p.code)}
                disabled={busy}
              >
                {p.label}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
