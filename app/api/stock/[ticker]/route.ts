import { NextResponse } from "next/server";
import { liveReport } from "@/lib/live";
import { loadReplay } from "@/lib/replay";
import { isTicker } from "@/lib/stocks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request, ctx: { params: Promise<{ ticker: string }> }) {
  const t = (await ctx.params).ticker.toUpperCase();
  if (!isTicker(t)) return NextResponse.json({ error: "unknown ticker" }, { status: 404 });
  if (new URL(req.url).searchParams.get("mode") === "replay") {
    const r = (await loadReplay())?.board.reports.find((x) => x.ticker === t);
    return r ? NextResponse.json(r) : NextResponse.json({ error: "replay unavailable" }, { status: 404 });
  }
  try {
    return NextResponse.json(await liveReport(t));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
