// prices → on-chain → news → score (one Claude call) → report. Cached so the LLM is never called per page view.
import { createHash } from "node:crypto";
import { cached } from "./cache";
import { impact1k, prices as jupPrices } from "./jupiter";
import { formatEt, marketClock } from "./market-hours";
import { headlines as fetchHeadlines, quote, type Headline } from "./news";
import { bigTrades, buildEvents, poolCandles, pools as fetchPools, supply as fetchSupply, type OnchainEvent, type Pool, type Trade } from "./onchain";
import { latest, priceAt, regularClose, type Candle } from "./pyth";
import { getScorer } from "./scorer";
import type { ScoreInputEvent, ScoreMeta, ScoreOutput } from "./scorer/types";
import { stats, takeLlmBudget } from "./stats";
import { CROSS, CROSS_LABEL, STOCKS, type Stock, type Ticker } from "./stocks";
import type { CrossRow, Flag, Mode, PricePoint, TickerReport } from "./types";

const RESCORE_MIN = Number(process.env.RESCORE_MINUTES ?? 90);
const lastScored = new Map<string, { at: number; gap: number; output: ScoreOutput; meta: ScoreMeta & { name: string }; textOf: Map<string, string> }>();

export const LIVE_TTL = 10 * 60_000; // re-gather every 10 min; the LLM only runs when the inputs change (hash cache)

/** Everything the report needs, gathered either live or from history (replay script). */
export type Gathered = {
  window: { from: number; to: number; label: string };
  session: string;
  reference: PricePoint | null;
  tokenPrice: PricePoint | null;
  pools: Pool[];
  hourly: Candle[];
  trades: Trade[] | null;
  pairedWindow?: { pool: Pool; otherMovePct: number | null; volUsd: number; peakTime: number }[];
  thin: { impactPct: number; route: string } | null;
  supply: number | null;
  headlines: Headline[];
  cross: CrossRow[];
  unavailable: string[];
};

const settle = async <T>(p: Promise<T>, what: string, miss: string[]): Promise<T | null> => {
  try {
    return await p;
  } catch (e) {
    console.warn(`[pipeline] ${what}:`, (e as Error).message);
    miss.push(what);
    return null;
  }
};

export function windowLabel(from: number, to: number, openNow: boolean) {
  const f = (s: number) => formatEt(s * 1000, { month: "short", day: "numeric" });
  return openNow ? `since ${f(from)} ET close · market open` : `${f(from)} → ${f(to)} ET`;
}

/** Cross-asset % change over [from, to] from Pyth (only entitled feeds; others stay null). */
export async function crossAssets(from: number, to: number | null, miss: string[]): Promise<CrossRow[]> {
  const feeds = Object.values(CROSS);
  const [a, b] = await Promise.all([
    settle(priceAt(feeds, from), "Pyth cross-asset (start)", miss),
    settle(to == null ? latest(feeds) : priceAt(feeds, to), "Pyth cross-asset (end)", miss),
  ]);
  return (Object.keys(CROSS) as (keyof typeof CROSS)[]).map((k) => {
    const s = a?.get(CROSS[k].symbol)?.price, e = b?.get(CROSS[k].symbol)?.price;
    return { key: k, label: CROSS_LABEL[k], pct: s && e ? ((e - s) / s) * 100 : null };
  });
}

async function gatherLive(stock: Stock): Promise<Gathered> {
  const miss: string[] = [];
  const clock = marketClock();
  const open = clock.state === "OPEN";
  const now = Math.floor(Date.now() / 1000);
  const from = Math.floor(clock.lastClose / 1000);

  // Reference: Pyth equity (entitled feeds only) → Finnhub, labelled.
  let reference: PricePoint | null = null;
  if (open) {
    const p = (await settle(latest([stock.equity]), "Pyth equity", miss))?.get(stock.equity.symbol);
    if (p) reference = { price: p.price, time: p.publishTime, source: "pyth", label: "NYSE NOW · PYTH" };
  } else {
    const p = await settle(regularClose(stock.equity, from), "Pyth equity close", miss);
    if (p) reference = { price: p.price, time: from, source: "pyth", label: "LAST CLOSE · PYTH" };
  }
  if (!reference) {
    const q = await settle(quote(stock.ticker), "Finnhub quote", miss);
    if (q) reference = { price: q.price, time: q.time, source: "finnhub", label: open ? "NYSE NOW · FINNHUB" : "LAST CLOSE · FINNHUB" };
    else miss.push("reference price");
  }

  // Token price: Pyth xStock feed if entitled, else Jupiter.
  let tokenPrice: PricePoint | null = null;
  const px = (await settle(latest([stock.xstock]), "Pyth xStock", miss))?.get(stock.xstock.symbol);
  if (px) tokenPrice = { price: px.price, time: px.publishTime, source: "pyth", label: `${stock.token} NOW · PYTH` };
  else {
    const j = (await settle(jupPrices(Object.values(STOCKS).map((s) => s.mint)), "Jupiter price", miss))?.get(stock.mint);
    if (j) tokenPrice = { price: j, time: now, source: "jupiter", label: `${stock.token} NOW · JUPITER` };
  }

  const [pools, thin, supply, headlines, cross] = await Promise.all([
    settle(fetchPools(stock), "DexScreener pools", miss),
    impact1k(stock.mint),
    fetchSupply(stock.mint),
    settle(fetchHeadlines(stock.ticker, stock.query, from, now, stock.keywords), "news (Finnhub + Google News)", miss),
    crossAssets(from, null, miss),
  ]);
  const main = pools?.find((p) => !p.paired) ?? null;
  const [hourly, trades] = main
    ? await Promise.all([
        settle(poolCandles(main.address, stock.mint, 60, from, now), "GeckoTerminal candles", miss),
        settle(bigTrades(main.address, 25_000), "GeckoTerminal trades", miss),
      ])
    : [null, null];

  return {
    window: { from, to: now, label: windowLabel(from, now, open) },
    session: { OPEN: "regular-session", "AFTER-HOURS": "after-hours", OVERNIGHT: "overnight", WEEKEND: "weekend" }[clock.state],
    reference,
    tokenPrice,
    pools: pools ?? [],
    hourly: hourly ?? [],
    trades,
    thin: thin ? { impactPct: thin.pct, route: thin.route } : null,
    supply,
    headlines: headlines?.items ?? [],
    cross,
    unavailable: miss,
  };
}

function flagFor(d: TickerReport["driver"]): Flag {
  if (!d) return "UNSCORED";
  const news = d.news * 100, chain = d.onchain * 100;
  if (news + chain < 40) return "UNEXPLAINED";
  if (news >= 40 && chain >= 25) return "NEWS + ON-CHAIN";
  return news >= chain ? "NEWS" : "ON-CHAIN";
}

const CAT_LABEL: Record<string, string> = {
  earnings: "EARNINGS",
  guidance: "GUIDANCE",
  analyst: "ANALYST",
  macro: "MACRO",
  legal_regulatory: "LEGAL / REGULATORY",
  product: "PRODUCT",
  m_and_a: "M&A",
  sector: "SECTOR",
  onchain: "ON-CHAIN",
  other: "OTHER",
};
const KIND_LABEL: Record<string, string> = { whale_trade: "WHALE", volume_spike: "VOLUME SPIKE", pool_divergence: "POOL ≠ REF", paired_token: "MEMECOIN PAIR" };

/** Score (cached by input hash) and assemble the final report. Used by live and replay. */
export async function assemble(stock: Stock, g: Gathered, mode: Mode, opts: { force?: boolean } = {}): Promise<TickerReport> {
  const tokenP = g.tokenPrice?.price ?? null, refP = g.reference?.price ?? null;
  const gapPct = tokenP && refP ? ((tokenP - refP) / refP) * 100 : null;
  const main = g.pools.find((p) => !p.paired) ?? null;
  const onchain: OnchainEvent[] = buildEvents({
    stock,
    pools: g.pools,
    mainPool: main,
    hourly: g.hourly,
    trades: g.trades,
    refPrice: tokenP,
    fromSec: g.window.from,
    toSec: g.window.to,
    pairedWindow: g.pairedWindow,
  });
  const heads = g.headlines.map((h, i) => ({ ...h, ref: `N${i + 1}` }));
  const prices = g.hourly.flatMap((c) => [c.h, c.l]).concat(tokenP ?? [], refP ?? []);
  const wick = prices.length ? { lo: Math.min(...prices), hi: Math.max(...prices) } : null;
  const thin = g.thin && g.thin.impactPct > 1;

  const events: ScoreInputEvent[] = [
    ...heads.map((h) => ({ ref: h.ref, kind: "news" as const, time: h.time, text: h.title, source: h.source })),
    ...onchain.map((e) => ({ ref: e.id, kind: "onchain" as const, time: e.time, text: `${e.title} (${e.detail})`, source: "on-chain" })),
  ];
  const crossText = g.cross.every((c) => c.pct == null)
    ? "unavailable"
    : g.cross.map((c) => `${c.label} ${c.pct == null ? "n/a" : `${c.pct >= 0 ? "+" : "−"}${Math.abs(c.pct).toFixed(2)}%`}`).join(", ");

  const input = {
    ticker: stock.ticker,
    token: stock.token,
    windowLabel: g.window.label,
    session: g.session,
    movePct: gapPct,
    refLabel: g.reference ? `${stock.token} vs ${g.reference.label.toLowerCase()}` : "reference unavailable",
    fromPrice: refP,
    toPrice: tokenP,
    thin: !!thin,
    cross: crossText,
    events,
  };

  let scored: { output: ScoreOutput; meta: ScoreMeta & { name: string } } | null = null;
  const unavailable = [...g.unavailable];
  // Live cost guard: reuse this ticker's last scoring for up to RESCORE_MIN unless the gap moved ≥ 1 pt.
  // Scores are carried over by event text; brand-new events stay unscored until the next rescoring.
  const prev = mode === "live" && !opts.force ? lastScored.get(stock.ticker) : undefined;
  if (prev && gapPct != null && Date.now() - prev.at < RESCORE_MIN * 60_000 && Math.abs(gapPct - prev.gap) < 1) {
    const byText = new Map(prev.output.scores.map((sc) => [prev.textOf.get(sc.ref), sc]));
    const newRef = new Map(events.map((e) => [e.text, e.ref]));
    scored = {
      meta: prev.meta,
      output: {
        ...prev.output,
        scores: events.flatMap((e) => {
          const sc = byText.get(e.text);
          return sc ? [{ ...sc, ref: e.ref }] : [];
        }),
        explanation: prev.output.explanation.map((seg) => ({ text: seg.text, ref: seg.ref ? (newRef.get(prev.textOf.get(seg.ref) ?? "") ?? null) : null })),
      },
    };
  } else if (gapPct != null) {
    const hash = createHash("sha1")
      .update(JSON.stringify({ ...input, movePct: Math.round(gapPct * 2) / 2, fromPrice: null, toPrice: null, events: events.map((e) => [e.ref, e.text]) }))
      .digest("hex");
    try {
      scored = await cached(`score:${stock.ticker}:${hash}`, 6 * 3_600_000, async () => {
        if (!opts.force && !takeLlmBudget()) throw new Error("daily LLM budget reached");
        const scorer = getScorer();
        const r = await scorer.score(input);
        stats.llmCalls++;
        stats.llmCostUsd += r.meta.costUsd;
        stats.llmLatencyMs.push(r.meta.latencyMs);
        return { output: r.output, meta: { ...r.meta, name: scorer.name } };
      });
      if (mode === "live" && scored)
        lastScored.set(stock.ticker, { at: Date.now(), gap: gapPct, output: scored.output, meta: scored.meta, textOf: new Map(events.map((e) => [e.ref, e.text])) });
    } catch (e) {
      console.warn(`[pipeline] scoring ${stock.ticker}:`, (e as Error).message);
      unavailable.push(`scoring (${(e as Error).message})`);
    }
  } else unavailable.push("scoring (no move to explain: price unavailable)");

  const scoreOf = (ref: string) => {
    const s = scored?.output.scores.find((x) => x.ref === ref);
    return s ? { caused_move: s.caused_move, category: s.category, importance: s.importance } : null;
  };
  const headlineRows = heads.map((h) => ({ ref: h.ref, title: h.title, source: h.source, url: h.url, time: h.time, score: scoreOf(h.ref) }));
  const onchainRows = onchain.map((e) => ({ ...e, score: scoreOf(e.id) }));
  const driver = scored?.output.driver ?? null;
  const top = [...headlineRows, ...onchainRows.map((e) => ({ ...e, ref: e.id }))]
    .filter((r) => r.score && r.score.caused_move >= 0.15)
    .sort((a, b) => b.score!.caused_move - a.score!.caused_move)
    .slice(0, 2);
  const categoryLabel = top
    .map((r) => ("kind" in r ? `ON-CHAIN · ${KIND_LABEL[r.kind]}` : CAT_LABEL[r.score!.category]))
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(" + ");

  stats.headlines += headlineRows.length;
  stats.onchainEvents += onchainRows.length;

  return {
    ticker: stock.ticker,
    token: stock.token,
    name: stock.name,
    mint: stock.mint,
    mode,
    window: g.window,
    reference: g.reference,
    tokenPrice: g.tokenPrice,
    gapPct,
    wick,
    thin: g.thin,
    headlines: headlineRows,
    onchain: onchainRows,
    tradesAvailable: g.trades != null,
    driver,
    flag: flagFor(driver),
    categoryLabel: categoryLabel || (driver ? "NO STRONG CATALYST" : ""),
    alert: scored?.output.alert_holders ?? null,
    reason: scored?.output.reason ?? null,
    explanation: scored?.output.explanation ?? [],
    pools: g.pools.slice(0, 12),
    supply: g.supply,
    cross: g.cross,
    scorer: scored?.meta ?? null,
    unavailable,
    generatedAt: Date.now(),
  };
}

/** Gather live inputs and build a report (no caching: callers decide). */
export async function buildLive(ticker: Ticker): Promise<TickerReport> {
  return assemble(STOCKS[ticker], await gatherLive(STOCKS[ticker]), "live");
}

