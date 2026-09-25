// Records a real past weekend into data/replay/2026-09-20.json (run once; the demo then makes zero API/LLM calls).
//   npx tsx scripts/build-replay.ts
// Window: Fri 18 Sep 2026 16:00 ET (NYSE close) → Sun 20 Sep 2026 20:00 ET.
// Sources, all real and labelled in the fixture:
//   Friday close  : Pyth Pro History (feeds our key is entitled to) → Yahoo Finance daily close (fallback)
//   Token price   : xStock main DEX pool, hourly close at Sun 20:00 ET (GeckoTerminal) — Pyth xStock feeds not entitled
//   Candles       : GeckoTerminal pool OHLCV (5/15/60 min)
//   On-chain      : main-pool hourly volume spikes + paired-token pools measured over the window
//   News          : Finnhub → Google News RSS (date-bounded), filtered to the company
//   Cross-asset   : Pyth Benchmarks at both ends (gold, BTC, EUR/USD)
//   Scoring       : Claude Haiku 4.5 (one call per ticker)
import { mkdirSync, writeFileSync } from "node:fs";
import { boardFrom } from "../lib/board";
import { headlines } from "../lib/news";
import { poolCandles, pools as fetchPools, type Pool } from "../lib/onchain";
import { assemble, crossAssets, windowLabel, type Gathered } from "../lib/pipeline";
import { regularClose, type Candle } from "../lib/pyth";
import { REPLAY_FILE, REPLAY_LABEL, type ReplayFixture } from "../lib/replay";
import { STOCKS, TICKERS, type Stock } from "../lib/stocks";
import type { ChartPayload, PricePoint, TickerReport } from "../lib/types";

process.loadEnvFile?.(".env.local");

const FROM = Date.parse("2026-09-18T16:00:00-04:00") / 1000;
const TO = Date.parse("2026-09-20T20:00:00-04:00") / 1000;
const NEXT_OPEN = Date.parse("2026-09-21T09:30:00-04:00");

async function yahooClose(ticker: string): Promise<number | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${FROM - 12 * 3600}&period2=${FROM + 12 * 3600}&interval=1d`;
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) return null;
  const res = (await r.json()).chart?.result?.[0];
  const i = (res?.timestamp as number[] | undefined)?.findIndex((t) => new Date(t * 1000).toISOString().slice(0, 10) === "2026-09-18");
  const c = i != null && i >= 0 ? res.indicators.quote[0].close[i] : null;
  return typeof c === "number" ? c : null;
}

async function fridayClose(stock: Stock, miss: string[]): Promise<PricePoint | null> {
  const p = await regularClose(stock.equity, FROM).catch(() => null);
  if (p) return { price: p.price, time: FROM, source: "pyth", label: "FRI CLOSE · PYTH" };
  const y = await yahooClose(stock.ticker).catch(() => null);
  if (y) return { price: y, time: FROM, source: "yahoo", label: "FRI CLOSE · YAHOO FINANCE" };
  miss.push("Friday close");
  return null;
}

const closeAt = (cs: Candle[], t: number) => cs.filter((c) => c.t <= t).at(-1)?.c ?? null;

async function pairedStats(stock: Stock, paired: Pool[]) {
  const out: NonNullable<Gathered["pairedWindow"]> = [];
  for (const p of paired.slice(0, 3)) {
    // Price of the OTHER token in USD over the window, and the pool's volume.
    const cs = await poolCandles(p.address, p.otherAddress, 60, FROM, TO).catch(() => []);
    if (!cs.length) continue;
    const vol = cs.reduce((s, c) => s + (c.v ?? 0), 0);
    const first = cs[0].o, last = cs.at(-1)!.c;
    const peak = cs.reduce((a, b) => ((b.v ?? 0) > (a.v ?? 0) ? b : a));
    out.push({ pool: p, otherMovePct: first ? ((last - first) / first) * 100 : null, volUsd: vol, peakTime: peak.t });
  }
  return out;
}

async function record(stock: Stock): Promise<{ report: TickerReport; charts: ReplayFixture["charts"][string] }> {
  const miss: string[] = [];
  const pools = await fetchPools(stock);
  const main = pools.find((p) => !p.paired) ?? null;
  const charts: ReplayFixture["charts"][string] = {};
  let hourly: Candle[] = [];
  if (main) {
    for (const res of [60, 15, 5] as const) {
      const cs = await poolCandles(main.address, stock.mint, res, FROM, TO).catch((e) => {
        miss.push(`${res}-min candles (${(e as Error).message})`);
        return [] as Candle[];
      });
      if (cs.length) charts[String(res) as "5" | "15" | "60"] = { resolution: res, source: "geckoterminal", candles: cs } satisfies ChartPayload;
      if (res === 60) hourly = cs;
    }
  } else miss.push("main pool");

  const tokenClose = closeAt(hourly, TO);
  const tokenPrice: PricePoint | null = tokenClose
    ? { price: tokenClose, time: TO, source: "geckoterminal", label: `${stock.token} SUN 8 PM · ${main!.dex.toUpperCase()} POOL` }
    : null;

  const [reference, news, cross, pairedWindow] = await Promise.all([
    fridayClose(stock, miss),
    headlines(stock.ticker, stock.query, FROM, TO, stock.keywords, 60_000).catch((e) => {
      miss.push(`news (${(e as Error).message})`);
      return { items: [], via: "google-news" as const };
    }),
    crossAssets(FROM, TO, miss),
    pairedStats(stock, pools.filter((p) => p.paired)),
  ]);

  const g: Gathered = {
    window: { from: FROM, to: TO, label: windowLabel(FROM, TO, false) },
    session: "weekend",
    reference,
    tokenPrice,
    pools,
    hourly,
    trades: null, // trade-level history needs an indexer we don't have: stated in the UI
    pairedWindow,
    thin: null,
    supply: null,
    headlines: news.items,
    cross,
    unavailable: [...miss, "whale trades (no historical trade indexer)", "$1k depth (live-only)", "supply change (no snapshot)"],
  };
  const report = await assemble(stock, g, "replay", { force: true });
  console.log(
    `${stock.ticker.padEnd(5)} ref ${reference?.price.toFixed(2)} (${reference?.label}) → ${tokenPrice?.price.toFixed(2)}  gap ${report.gapPct?.toFixed(2)}%  ` +
      `news ${news.items.length} via ${news.via}  events ${report.onchain.length}  ${report.flag}  $${report.scorer?.costUsd.toFixed(4)}\n      ${report.reason}`,
  );
  return { report, charts };
}

async function main() {
  const reports: TickerReport[] = [];
  const charts: ReplayFixture["charts"] = {};
  for (const t of TICKERS) {
    const r = await record(STOCKS[t]);
    reports.push(r.report);
    charts[t] = r.charts;
  }
  const board = boardFrom(reports, "replay", { state: "WEEKEND", lastClose: FROM * 1000, nextOpen: NEXT_OPEN }, REPLAY_LABEL);
  board.generatedAt = Date.now();
  mkdirSync("data/replay", { recursive: true });
  writeFileSync(REPLAY_FILE, JSON.stringify({ board, charts } satisfies ReplayFixture));
  console.log(`\nwrote ${REPLAY_FILE}: ${board.stats.headlines} headlines, ${board.stats.onchainEvents} on-chain events, ${board.stats.llmCalls} Claude calls, $${board.stats.llmCostUsd.toFixed(4)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
