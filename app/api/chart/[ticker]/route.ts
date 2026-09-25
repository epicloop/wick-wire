import { NextResponse } from "next/server";
import { chartFor } from "@/lib/chart";
import { marketClock } from "@/lib/market-hours";
import { loadReplay } from "@/lib/replay";
import { STOCKS, isTicker } from "@/lib/stocks";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ ticker: string }> }) {
  const t = (await ctx.params).ticker.toUpperCase();
  if (!isTicker(t)) return NextResponse.json({ error: "unknown ticker" }, { status: 404 });
  const sp = new URL(req.url).searchParams;
  const res = ([5, 15, 60] as const).find((r) => String(r) === sp.get("res")) ?? 15;
  if (sp.get("mode") === "replay") {
    const c = (await loadReplay())?.charts[t]?.[String(res) as "5" | "15" | "60"];
    return c ? NextResponse.json(c) : NextResponse.json({ error: "replay chart unavailable" }, { status: 404 });
  }
  const from = Math.floor(marketClock().lastClose / 1000);
  const c = await chartFor(STOCKS[t], res, from, Math.floor(Date.now() / 1000));
  return c ? NextResponse.json(c) : NextResponse.json({ error: "chart unavailable" }, { status: 502 });
}
