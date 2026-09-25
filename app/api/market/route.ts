import { NextResponse } from "next/server";
import { marketClock } from "@/lib/market-hours";
import { loadReplay } from "@/lib/replay";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get("mode") === "replay") {
    const fx = await loadReplay();
    return fx ? NextResponse.json(fx.board.market) : NextResponse.json({ error: "replay unavailable" }, { status: 404 });
  }
  const c = marketClock();
  return NextResponse.json({ state: c.state, lastClose: c.lastClose, nextOpen: c.nextOpen });
}
