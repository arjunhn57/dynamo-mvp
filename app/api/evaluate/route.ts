import { NextResponse } from "next/server";
import { runEvaluation } from "@/lib/evaluate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET so Vercel Cron and a plain browser hit both work. Idempotent.
// ?failWeather=1 forces the provider offline so the fail-safe can be demonstrated.
export async function GET(req: Request) {
  try {
    const failWeather = new URL(req.url).searchParams.get("failWeather") === "1";
    return NextResponse.json(await runEvaluation({ failWeather }));
  } catch (e) {
    console.error("evaluate failed", e);
    return NextResponse.json({ ok: false, error: "Evaluation failed" }, { status: 500 });
  }
}

export const POST = GET;
