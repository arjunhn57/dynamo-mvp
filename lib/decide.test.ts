import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, HOT_C, type Weather } from "./decide";

// Run with:  npx tsx --test lib/decide.test.ts
// The engine is pure, so these are fast and deterministic.

const base = (over: Partial<Weather> = {}): Weather => ({
  tempC: 30,
  precipMm: 0,
  fetchedAt: new Date().toISOString(),
  stale: false,
  ok: true,
  ...over,
});

test("CMO pin overrides everything, even extreme weather", () => {
  const d = decide(base({ tempC: 42, precipMm: 5 }), { pin: "CR-RAIN" });
  assert.equal(d.creative, "CR-RAIN");
  assert.equal(d.confident, true);
});

test("weather unavailable -> safe generic, low confidence", () => {
  const d = decide(base({ ok: false, tempC: null }));
  assert.equal(d.creative, "CR-NORM");
  assert.equal(d.confident, false);
});

test("stale weather -> safe generic, even if it looks hot", () => {
  const d = decide(base({ stale: true, tempC: 40 }));
  assert.equal(d.creative, "CR-NORM");
  assert.equal(d.confident, false);
});

test("rain beats heat when both are true (the CMO's nightmare case)", () => {
  const d = decide(base({ tempC: 40, precipMm: 2 }));
  assert.equal(d.creative, "CR-RAIN");
});

test("valid temp but missing precip -> safe generic (cannot rule out rain)", () => {
  const d = decide(base({ tempC: 40, precipMm: null }));
  assert.equal(d.creative, "CR-NORM");
  assert.equal(d.confident, false);
});

test("trace drizzle below 0.2mm is not 'raining'", () => {
  const d = decide(base({ tempC: 30, precipMm: 0.1 }));
  assert.equal(d.creative, "CR-NORM");
});

test("hot and dry -> beat the heat (boundary at exactly HOT_C)", () => {
  const d = decide(base({ tempC: HOT_C, precipMm: 0 }));
  assert.equal(d.creative, "CR-HOT");
});

test("mild and dry -> generic", () => {
  const d = decide(base({ tempC: 28, precipMm: 0 }));
  assert.equal(d.creative, "CR-NORM");
});
