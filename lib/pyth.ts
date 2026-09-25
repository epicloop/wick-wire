// Pyth access. Every call is authenticated and our key is a DEMO plan, so:
//  - we ask Pyth which feeds the key is entitled to (1 call / hour) and only ever request those
//    (a single non-entitled id makes the whole request 403),
//  - everything is batched and cached; callers fall back (labelled) for non-entitled feeds.
import { z } from "zod";
import { cached } from "./cache";
import { stats } from "./stats";
import type { FeedMeta } from "./stocks";

const HERMES = "https://hermes.pyth.network";
const BENCH = "https://benchmarks.pyth.network";
const PRO = "https://pyth.dourolabs.app/v1";

function headers() {
  const key = process.env.PYTH_API_KEY;
  if (!key) throw new Error("PYTH_API_KEY not set");
  return { Authorization: `Bearer ${key}` };
}

async function get(url: string) {
  stats.pythCalls++;
  const r = await fetch(url, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`pyth ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

const SymbolsSchema = z.array(z.object({ pyth_lazer_id: z.number(), symbol: z.string() }));

/** Lazer ids our key may read. Empty set if Pyth is unreachable (everything then falls back). */
export async function entitledIds(): Promise<Set<number>> {
  if (!process.env.PYTH_API_KEY) return new Set();
  return cached("pyth:entitled", 60 * 60_000, async () => {
    const list = SymbolsSchema.parse(await get(`${PRO}/symbols?entitled_only=true`));
    return new Set(list.map((s) => s.pyth_lazer_id));
  }).catch(() => new Set<number>());
}

export async function isEntitled(feed: FeedMeta) {
  return (await entitledIds()).has(feed.lazerId);
}

const Parsed = z.object({
  parsed: z.array(
    z.object({
      id: z.string(),
      price: z.object({ price: z.string(), conf: z.string(), expo: z.number(), publish_time: z.number() }),
    }),
  ),
});

export type PythPrice = { symbol: string; price: number; conf: number; publishTime: number; source: "pyth" };

function toPrices(feeds: FeedMeta[], body: unknown): Map<string, PythPrice> {
  const byId = new Map(feeds.map((f) => [f.hermesId.replace(/^0x/, ""), f]));
  const out = new Map<string, PythPrice>();
  for (const p of Parsed.parse(body).parsed) {
    const f = byId.get(p.id.replace(/^0x/, ""));
    if (!f) continue;
    const scale = 10 ** p.price.expo;
    out.set(f.symbol, {
      symbol: f.symbol,
      price: Number(p.price.price) * scale,
      conf: Number(p.price.conf) * scale,
      publishTime: p.price.publish_time,
      source: "pyth",
    });
  }
  return out;
}

async function entitledOnly(feeds: FeedMeta[]) {
  const ok = await entitledIds();
  return feeds.filter((f) => ok.has(f.lazerId));
}

/** Latest prices for the entitled subset of `feeds` (one batched Hermes call, cached 60 s). */
export async function latest(feeds: FeedMeta[]): Promise<Map<string, PythPrice>> {
  const use = await entitledOnly(feeds);
  if (!use.length) return new Map();
  const ids = use.map((f) => f.hermesId).sort();
  return cached(`pyth:latest:${ids.join(",")}`, 60_000, async () => {
    const qs = ids.map((id) => `ids[]=${id}`).join("&");
    return toPrices(use, await get(`${HERMES}/v2/updates/price/latest?parsed=true&${qs}`));
  });
}

/** First Pyth update at/after `tsSec` (Benchmarks) for the entitled subset. Immutable → cached 24 h. */
export async function priceAt(feeds: FeedMeta[], tsSec: number): Promise<Map<string, PythPrice>> {
  const use = await entitledOnly(feeds);
  if (!use.length) return new Map();
  const ids = use.map((f) => f.hermesId).sort();
  return cached(`pyth:at:${tsSec}:${ids.join(",")}`, 24 * 3_600_000, async () => {
    const qs = ids.map((id) => `ids=${id}`).join("&");
    return toPrices(use, await get(`${BENCH}/v1/updates/price/${tsSec}?parsed=true&${qs}`));
  });
}

const Udf = z.object({
  s: z.string(),
  t: z.array(z.number()).optional(),
  o: z.array(z.number()).optional(),
  h: z.array(z.number()).optional(),
  l: z.array(z.number()).optional(),
  c: z.array(z.number()).optional(),
});

export type Candle = { t: number; o: number; h: number; l: number; c: number; v?: number };

/** OHLC candles from Pyth Pro History (UDF). Prices are already decimals. Null if not entitled. */
export async function candles(feed: FeedMeta, resolution: 5 | 15 | 60, fromSec: number, toSec: number): Promise<Candle[] | null> {
  if (!(await isEntitled(feed))) return null;
  const channel = feed.minChannel === "real_time" ? "fixed_rate@200ms" : feed.minChannel === "fixed_rate@50ms" ? "fixed_rate@50ms" : "fixed_rate@200ms";
  const key = `pyth:candles:${feed.lazerId}:${resolution}:${fromSec}:${toSec}`;
  return cached(key, toSec < Date.now() / 1000 - 3600 ? 24 * 3_600_000 : 5 * 60_000, async () => {
    const url = `${PRO}/${channel}/history?symbol=${encodeURIComponent(feed.symbol)}&resolution=${resolution}&from=${fromSec}&to=${toSec}`;
    const u = Udf.parse(await get(url));
    if (u.s !== "ok" || !u.t) return [];
    return u.t.map((t, i) => ({ t, o: u.o![i], h: u.h![i], l: u.l![i], c: u.c![i] }));
  });
}

/** Regular-session close: close of the 60-min candle ending at `closeSec` (e.g. Fri 16:00 ET). */
export async function regularClose(feed: FeedMeta, closeSec: number): Promise<PythPrice | null> {
  const cs = await candles(feed, 60, closeSec - 3 * 3600, closeSec);
  if (!cs?.length) return null;
  const last = cs.filter((c) => c.t < closeSec).at(-1);
  if (!last) return null;
  return { symbol: feed.symbol, price: last.c, conf: 0, publishTime: closeSec, source: "pyth" };
}
