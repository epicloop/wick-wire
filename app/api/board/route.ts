import { NextResponse } from "next/server";
import { liveBoard } from "@/lib/live";
import { loadReplay } from "@/lib/replay";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const mode = new URL(req.url).searchParams.get("mode") === "replay" ? "replay" : "live";
  if (mode === "replay") {
    const fx = await loadReplay();
    if (!fx) return NextResponse.json({ error: "replay fixture unavailable" }, { status: 404 });
    return NextResponse.json({ ...fx.board, backtest: fx.backtest });
  }
  try {
    return NextResponse.json(await liveBoard());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
