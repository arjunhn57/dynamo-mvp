import { NextRequest, NextResponse } from "next/server";
import { setControl } from "@/lib/db";
import type { CreativeCode } from "@/lib/decide";

export const dynamic = "force-dynamic";

const VALID_PINS: CreativeCode[] = ["CR-HOT", "CR-RAIN", "CR-NORM"];
// Only "global" or a real campaign city may be stored — an allowlist so a stray
// or hostile scope can't pile unbounded permanent rows into the controls table.
const VALID_SCOPES = ["global", "Mumbai", "Delhi", "Bangalore", "Chennai"];

// The CMO's override switch.
//   { scope: "global",  hold: true }            -> freeze the whole campaign
//   { scope: "Mumbai",  hold: true }            -> freeze one city on its current state
//   { scope: "Mumbai",  pin: "CR-RAIN" }        -> force one creative in a city
//   { scope: "Mumbai",  hold: false, pin: null } -> hand control back to automation
export async function POST(req: NextRequest) {
  let body: { scope?: string; hold?: boolean; pin?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }
  try {
    const scope = String(body.scope ?? "").trim();
    if (!VALID_SCOPES.includes(scope)) {
      return NextResponse.json({ ok: false, error: "unknown scope" }, { status: 400 });
    }
    // Strict boolean — a string like "false" must not coerce into a freeze.
    const hold = body.hold === true;
    // Hold wins over pin: freezing a city clears any forced creative, so the two
    // controls can never conflict. "global" can only freeze.
    const pin: CreativeCode | null =
      !hold && scope !== "global" && VALID_PINS.includes(body.pin as CreativeCode)
        ? (body.pin as CreativeCode)
        : null;

    await setControl(scope, hold, pin);
    return NextResponse.json({ ok: true, scope, hold, pin });
  } catch (e) {
    console.error("override failed", e);
    return NextResponse.json({ ok: false, error: "Could not save the change" }, { status: 500 });
  }
}
