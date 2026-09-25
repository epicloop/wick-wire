import { NextResponse } from "next/server";
import { cached } from "@/lib/cache";
import { prices as jupPrices } from "@/lib/jupiter";
import { STOCKS, TICKERS } from "@/lib/stocks";

export const dynamic = "force-dynamic";

type Pair = { baseToken: { address: string }; quoteToken: { symbol: string }; priceUsd?: string; liquidity?: { usd?: number } };

// Live xStock prices for the scanner: each token's deepest USDC pool (one batched DexScreener call, cached 15 s).
// Price v3 from Jupiter is only a fallback (it can lag the pools by ~0.5%).
export async function GET() {
  try {
    const out = await cached("prices:ds", 15_000, async () => {
      const mints = TICKERS.map((t) => STOCKS[t].mint);
      const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mints.join(",")}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      const pairs: Pair[] = r.ok ? await r.json() : [];
      const res: Record<string, number> = {};
      for (const t of TICKERS) {
        const best = pairs
          .filter((p) => p.baseToken.address === STOCKS[t].mint && p.quoteToken.symbol === "USDC" && Number(p.priceUsd) > 0)
          .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
        if (best) res[t] = Number(best.priceUsd);
      }
      if (Object.keys(res).length < TICKERS.length) {
        const j = await jupPrices(mints).catch(() => new Map<string, number>());
        for (const t of TICKERS) if (res[t] == null && j.has(STOCKS[t].mint)) res[t] = j.get(STOCKS[t].mint)!;
      }
      return res;
    });
    return NextResponse.json({ at: Date.now(), source: "dexscreener (deepest USDC pool)", prices: out });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
