import { NextResponse } from "next/server";
import { loadReplay } from "@/lib/replay";

export async function GET() {
  const fx = await loadReplay();
  return fx?.backtest ? NextResponse.json(fx.backtest) : NextResponse.json({ error: "backtest unavailable" }, { status: 404 });
}
