import { NextResponse } from "next/server";
import { runEvaluation } from "@/lib/evaluate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET so Vercel Cron and a plain browser hit both work. Idempotent.
export async function GET() {
  try {
    return NextResponse.json(await runEvaluation());
  } catch (e) {
    console.error("evaluate failed", e);
    return NextResponse.json({ ok: false, error: "Evaluation failed" }, { status: 500 });
  }
}

export const POST = GET;
