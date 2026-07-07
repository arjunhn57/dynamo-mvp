import { NextRequest, NextResponse } from "next/server";
import { setControl } from "@/lib/db";
import type { CreativeCode } from "@/lib/decide";

export const dynamic = "force-dynamic";

const VALID_PINS: CreativeCode[] = ["CR-HOT", "CR-RAIN", "CR-NORM"];

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
    if (!scope) {
      return NextResponse.json({ ok: false, error: "scope is required" }, { status: 400 });
    }
    const hold = Boolean(body.hold);
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
