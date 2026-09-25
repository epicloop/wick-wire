// On-chain signals for an xStock mint → typed events scored alongside headlines.
// Sources (no keys): DexScreener pool list, GeckoTerminal pool OHLCV + trades, Solana RPC supply.
import { z } from "zod";
import { cached, throttle } from "./cache";
import { STABLE_OR_SOL, type Stock } from "./stocks";
import type { Candle } from "./pyth";

const GT = "https://api.geckoterminal.com/api/v2";
const DS = "https://api.dexscreener.com";
const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const gtSlot = throttle(2500); // GeckoTerminal free tier ≈ 30 req/min

export type Pool = {
  address: string;
  dex: string;
  pair: string;
  url: string;
  otherSymbol: string;
  otherAddress: string;
  paired: boolean; // other side is not USDC/USDT/SOL (e.g. a memecoin)
  liquidityUsd: number;
  volume24hUsd: number;
  change24hPct: number | null; // price change of the pool's base token
  otherChange24hPct: number | null; // the other token's own 24h move (paired pools)
  impliedPrice: number | null; // xStock USD price implied by this pool
};

export type OnchainKind = "whale_trade" | "volume_spike" | "pool_divergence" | "paired_token";

export type OnchainEvent = {
  id: string; // A, B, C… assigned later
  kind: OnchainKind;
  time: number; // unix sec
  title: string;
  detail: string;
  link: string;
  linkLabel: string;
};

const DsPair = z.object({
  dexId: z.string(),
  url: z.string(),
  pairAddress: z.string(),
  labels: z.array(z.string()).optional(),
  baseToken: z.object({ address: z.string(), symbol: z.string() }),
  quoteToken: z.object({ address: z.string(), symbol: z.string() }),
  priceNative: z.string().optional(),
  priceUsd: z.string().optional(),
  volume: z.object({ h24: z.number().optional() }).partial().optional(),
  priceChange: z.object({ h24: z.number().optional() }).partial().optional(),
  liquidity: z.object({ usd: z.number().optional() }).partial().optional(),
});

async function dsJson(url: string) {
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`dexscreener ${r.status}`);
  return r.json();
}

/** Every DEX pool that contains the xStock mint (DexScreener), biggest liquidity first. */
export async function pools(stock: Stock): Promise<Pool[]> {
  return cached(`ds:pools:${stock.mint}`, 5 * 60_000, async () => {
    const pairs = z.array(DsPair).parse(await dsJson(`${DS}/token-pairs/v1/solana/${stock.mint}`));
    // Other tokens' own 24h change (for paired pools), one batched call.
    const others = [...new Set(pairs.map((p) => (p.baseToken.address === stock.mint ? p.quoteToken.address : p.baseToken.address)))].filter(
      (a) => !STABLE_OR_SOL.has(a),
    );
    const otherChange = new Map<string, number>();
    if (others.length) {
      const list = z.array(DsPair).parse(await dsJson(`${DS}/tokens/v1/solana/${others.slice(0, 30).join(",")}`).catch(() => []));
      // Use each token's deepest pool as its reference move.
      for (const p of [...list].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))) {
        if (!otherChange.has(p.baseToken.address) && p.priceChange?.h24 != null) otherChange.set(p.baseToken.address, p.priceChange.h24);
      }
    }
    return pairs
      .map((p): Pool => {
        const xIsBase = p.baseToken.address === stock.mint;
        const other = xIsBase ? p.quoteToken : p.baseToken;
        const usd = Number(p.priceUsd), native = Number(p.priceNative);
        const implied = xIsBase ? usd : usd && native ? usd / native : NaN;
        return {
          address: p.pairAddress,
          dex: p.dexId + (p.labels?.length ? ` ${p.labels[0]}` : ""),
          pair: `${stock.token}/${other.symbol}`,
          url: p.url,
          otherSymbol: other.symbol,
          otherAddress: other.address,
          paired: !STABLE_OR_SOL.has(other.address),
          liquidityUsd: p.liquidity?.usd ?? 0,
          volume24hUsd: p.volume?.h24 ?? 0,
          change24hPct: xIsBase ? (p.priceChange?.h24 ?? null) : null,
          otherChange24hPct: STABLE_OR_SOL.has(other.address) ? null : (otherChange.get(other.address) ?? null),
          impliedPrice: Number.isFinite(implied) && implied > 0 ? implied : null,
        };
      })
      .sort((a, b) => b.liquidityUsd - a.liquidityUsd);
  });
}

async function gt(path: string) {
  for (let attempt = 0; ; attempt++) {
    const r = await gtSlot(() => fetch(`${GT}${path}`, { cache: "no-store", headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) }));
    if (r.status === 429 && attempt < 2) {
      await new Promise((res) => setTimeout(res, 12_000 * (attempt + 1)));
      continue;
    }
    if (r.status === 429) throw new Error("geckoterminal rate limited");
    if (!r.ok) throw new Error(`geckoterminal ${r.status}`);
    return r.json();
  }
}

const Ohlcv = z.object({ data: z.object({ attributes: z.object({ ohlcv_list: z.array(z.array(z.number())) }) }) });

/** USD candles of the xStock in one pool (GeckoTerminal). `minutes` ∈ 5 | 15 | 60. */
export async function poolCandles(pool: string, mint: string, minutes: 5 | 15 | 60, fromSec: number, toSec: number): Promise<Candle[]> {
  const [tf, agg] = minutes === 60 ? ["hour", 1] : ["minute", minutes];
  const limit = Math.min(1000, Math.ceil((toSec - fromSec) / (minutes * 60)) + 2);
  const ttl = toSec < Date.now() / 1000 - 3600 ? 24 * 3_600_000 : 5 * 60_000;
  return cached(`gt:ohlcv:${pool}:${minutes}:${fromSec}:${Math.floor(toSec / 300)}`, ttl, async () => {
    const body = Ohlcv.parse(await gt(`/networks/solana/pools/${pool}/ohlcv/${tf}?aggregate=${agg}&before_timestamp=${toSec}&limit=${limit}&currency=usd&token=${mint}`));
    return body.data.attributes.ohlcv_list
      .map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
      .filter((c) => c.t >= fromSec - minutes * 60 && c.t <= toSec)
      .sort((a, b) => a.t - b.t);
  });
}

const Trades = z.object({
  data: z.array(
    z.object({
      attributes: z.object({
        block_timestamp: z.string(),
        kind: z.string(),
        volume_in_usd: z.string(),
        tx_hash: z.string(),
        tx_from_address: z.string(),
      }),
    }),
  ),
});

export type Trade = { time: number; side: "buy" | "sell"; usd: number; tx: string; wallet: string };

/** Large trades in the last 24 h of one pool (GeckoTerminal keeps ~24 h: live mode only). */
export async function bigTrades(pool: string, minUsd: number): Promise<Trade[]> {
  return cached(`gt:trades:${pool}:${minUsd}`, 5 * 60_000, async () => {
    const body = Trades.parse(await gt(`/networks/solana/pools/${pool}/trades?trade_volume_in_usd_greater_than=${Math.floor(minUsd)}`));
    return body.data.map(({ attributes: a }) => ({
      time: Math.floor(Date.parse(a.block_timestamp) / 1000),
      side: a.kind === "sell" ? ("sell" as const) : ("buy" as const),
      usd: Number(a.volume_in_usd),
      tx: a.tx_hash,
      wallet: a.tx_from_address,
    }));
  });
}

export async function supply(mint: string): Promise<number | null> {
  return cached(`rpc:supply:${mint}`, 10 * 60_000, async () => {
    const r = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenSupply", params: [mint] }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const j = await r.json();
    return (j.result?.value?.uiAmount as number | undefined) ?? null;
  }).catch(() => null);
}

const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`);
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-3)}`;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Turn pools/candles/trades into at most 8 typed events (strongest first). */
export function buildEvents(input: {
  stock: Stock;
  pools: Pool[];
  mainPool: Pool | null;
  hourly: Candle[]; // main-pool hourly candles over the window (volume in USD)
  trades: Trade[] | null; // null = trade-level data unavailable (replay without indexer)
  refPrice: number | null;
  fromSec: number;
  toSec: number;
}): OnchainEvent[] {
  const { stock, pools: ps, mainPool, hourly, trades, refPrice, fromSec, toSec } = input;
  const ev: (OnchainEvent & { weight: number })[] = [];
  const windowVol = hourly.reduce((s, c) => s + (c.v ?? 0), 0);

  // Whale trades: ≥ max($50k, 10% of window volume); same wallet within 30 min → one event.
  if (trades && mainPool) {
    const min = Math.max(50_000, windowVol * 0.1);
    const big = trades.filter((t) => t.usd >= min && t.time >= fromSec && t.time <= toSec).sort((a, b) => a.time - b.time);
    const groups: Trade[][] = [];
    for (const t of big) {
      const g = groups.find((g) => g[0].wallet === t.wallet && g[0].side === t.side && t.time - g.at(-1)!.time < 1800);
      if (g) g.push(t);
      else groups.push([t]);
    }
    for (const g of groups) {
      const total = g.reduce((s, t) => s + t.usd, 0);
      const verb = g[0].side === "sell" ? "sold" : "bought";
      ev.push({
        id: "",
        kind: "whale_trade",
        time: g[0].time,
        title: `One wallet ${verb} ${usd(total)} of ${stock.token}${g.length > 1 ? ` in ${g.length} swaps` : ""} (${mainPool.dex} ${mainPool.pair})`,
        detail: `wallet ${short(g[0].wallet)} · ${g.length} tx`,
        link: `https://solscan.io/tx/${g[0].tx}`,
        linkLabel: `${short(g[0].tx)} · Solscan`,
        weight: total,
      });
    }
  }

  // Volume spikes: hour volume ≥ 3× the window's median hour.
  if (hourly.length >= 6 && mainPool) {
    const med = median(hourly.map((c) => c.v ?? 0));
    const spikes = hourly.filter((c) => med > 0 && (c.v ?? 0) >= 3 * med).sort((a, b) => (b.v ?? 0) - (a.v ?? 0)).slice(0, 2);
    for (const c of spikes) {
      const chg = ((c.c - c.o) / c.o) * 100;
      ev.push({
        id: "",
        kind: "volume_spike",
        time: c.t,
        title: `${usd(c.v ?? 0)} traded in one hour on ${mainPool.pair} (${((c.v ?? 0) / med).toFixed(1)}× normal), price ${chg >= 0 ? "+" : "−"}${Math.abs(chg).toFixed(2)}% that hour`,
        detail: `${mainPool.dex} · hourly candle`,
        link: `https://solscan.io/account/${mainPool.address}`,
        linkLabel: `${short(mainPool.address)} · Solscan`,
        weight: c.v ?? 0,
      });
    }
  }

  // Pool divergence: a pool with real liquidity pricing the xStock > 1% away from the reference.
  if (refPrice) {
    for (const p of ps.filter((p) => p.liquidityUsd >= 10_000 && p.impliedPrice)) {
      const dev = ((p.impliedPrice! - refPrice) / refPrice) * 100;
      if (Math.abs(dev) > 1)
        ev.push({
          id: "",
          kind: "pool_divergence",
          time: toSec,
          title: `${p.pair} on ${p.dex} prices ${stock.token} ${dev > 0 ? "+" : "−"}${Math.abs(dev).toFixed(1)}% vs the reference price`,
          detail: `pool liquidity ${usd(p.liquidityUsd)} · now`,
          link: `https://solscan.io/account/${p.address}`,
          linkLabel: `${short(p.address)} · Solscan`,
          weight: Math.abs(dev) * p.liquidityUsd,
        });
    }
  }

  // Paired tokens (memecoins etc.) with meaningful 24 h volume.
  const totalVol = ps.reduce((s, p) => s + p.volume24hUsd, 0) || 1;
  for (const p of ps.filter((p) => p.paired && p.volume24hUsd >= 10_000 && p.volume24hUsd / totalVol >= 0.02).sort((a, b) => b.volume24hUsd - a.volume24hUsd).slice(0, 3)) {
    const share = (p.volume24hUsd / totalVol) * 100;
    const mv = p.otherChange24hPct;
    ev.push({
      id: "",
      kind: "paired_token",
      time: toSec,
      title: `$${p.otherSymbol}, paired against ${stock.token}, ${mv == null ? "moved (24h change unavailable)" : `${mv >= 0 ? "+" : "−"}${Math.abs(mv).toFixed(0)}% in 24h`}; its pool is ${share.toFixed(0)}% of ${stock.token} DEX volume`,
      detail: `${p.dex} · liquidity ${usd(p.liquidityUsd)} · 24h vol ${usd(p.volume24hUsd)}`,
      link: `https://solscan.io/account/${p.address}`,
      linkLabel: `${short(p.address)} · Solscan`,
      weight: p.volume24hUsd,
    });
  }

  const order: OnchainKind[] = ["whale_trade", "volume_spike", "paired_token", "pool_divergence"];
  return ev
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.weight - a.weight)
    .slice(0, 8)
    .sort((a, b) => a.time - b.time)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .map(({ weight: _w, ...e }, i) => ({ ...e, id: String.fromCharCode(65 + i) }));
}
