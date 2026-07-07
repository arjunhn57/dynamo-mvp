import { NextResponse } from "next/server";
import { initSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

// One-shot: create the tables and seed the 12 line items. Safe to hit repeatedly
// (idempotent). Handy right after the first deploy.
export async function GET() {
  try {
    await initSchema();
    return NextResponse.json({ ok: true, message: "Schema ready and seeded." });
  } catch (e) {
    console.error("setup failed", e);
    return NextResponse.json({ ok: false, error: "Setup failed" }, { status: 500 });
  }
}
