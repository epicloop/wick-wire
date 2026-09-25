// Jupiter (no key): live xStock price fallback (Price v3, one batched call) and $1,000 USDC → xStock price impact.
import { z } from "zod";
import { cached } from "./cache";

const JUP = "https://lite-api.jup.ag";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const PriceV3 = z.record(z.string(), z.object({ usdPrice: z.number() }).passthrough().nullable());

export async function prices(mints: string[]): Promise<Map<string, number>> {
  const ids = [...mints].sort().join(",");
  return cached(`jup:price:${ids}`, 20_000, async () => {
    const r = await fetch(`${JUP}/price/v3?ids=${ids}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`jupiter price ${r.status}`);
    const body = PriceV3.parse(await r.json());
    return new Map(Object.entries(body).flatMap(([k, v]) => (v ? [[k, v.usdPrice] as const] : [])));
  });
}

const Quote = z.object({ priceImpactPct: z.string(), routePlan: z.array(z.object({ swapInfo: z.object({ label: z.string().optional() }) })) });

/** Price impact (%) of buying $1,000 of the token with USDC. */
export async function impact1k(mint: string): Promise<{ pct: number; route: string } | null> {
  return cached(`jup:impact:${mint}`, 5 * 60_000, async () => {
    const r = await fetch(`${JUP}/swap/v1/quote?inputMint=${USDC}&outputMint=${mint}&amount=1000000000&slippageBps=100`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const q = Quote.parse(await r.json());
    return { pct: Number(q.priceImpactPct) * 100, route: q.routePlan.map((p) => p.swapInfo.label ?? "?").join(" > ") };
  }).catch(() => null);
}
