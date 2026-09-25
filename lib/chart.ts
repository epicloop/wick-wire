// Candles for the detail chart: Pyth Pro History for the xStock feed when entitled, else the main
// USDC/SOL pool on GeckoTerminal (labelled). Volume always comes from the pool (Pyth has no volume).
import { cached } from "./cache";
import { pools, poolCandles } from "./onchain";
import { candles as pythCandles } from "./pyth";
import type { Stock } from "./stocks";
import type { ChartPayload } from "./types";

export async function chartFor(stock: Stock, resolution: 5 | 15 | 60, from: number, to: number): Promise<ChartPayload | null> {
  return cached(`chart:${stock.ticker}:${resolution}:${from}:${Math.floor(to / 300)}`, 5 * 60_000, async () => {
    const main = (await pools(stock)).find((p) => !p.paired);
    const poolC = main ? await poolCandles(main.address, stock.mint, resolution, from, to).catch(() => []) : [];
    const pyth = await pythCandles(stock.xstock, resolution, from, to).catch(() => null);
    if (pyth?.length) {
      const vol = new Map(poolC.map((c) => [c.t, c.v]));
      return { resolution, source: "pyth" as const, candles: pyth.map((c) => ({ ...c, v: vol.get(c.t) })) };
    }
    return poolC.length ? { resolution, source: "geckoterminal" as const, candles: poolC } : null;
  }).catch(() => null);
}
