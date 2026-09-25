import { NextResponse } from "next/server";
import { prices } from "@/lib/jupiter";
import { STOCKS, TICKERS } from "@/lib/stocks";

export const dynamic = "force-dynamic";

// Live xStock prices for the scanner (one batched Jupiter call, cached ~20 s server-side).
export async function GET() {
  try {
    const m = await prices(TICKERS.map((t) => STOCKS[t].mint));
    const out = Object.fromEntries(TICKERS.flatMap((t) => (m.has(STOCKS[t].mint) ? [[t, m.get(STOCKS[t].mint)!]] : [])));
    return NextResponse.json({ at: Date.now(), source: "jupiter", prices: out });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
