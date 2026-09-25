// Regression suite: pure-logic unit checks + production data verified against independent sources.
//   npx tsx scripts/regression.ts [baseUrl]
// Budget-aware: Yahoo 1 call/ticker, DexScreener 1 call/ticker, Binance 2 calls, our own API otherwise (no direct Pyth/LLM calls).
import { readFileSync } from "node:fs";
import { lastClose, marketState, nextOpen } from "../lib/market-hours";
import { sanitize } from "../lib/scorer/types";
import { backtestRow, signalFor, FEE_PER_SIDE_PCT } from "../lib/signal";
import { STOCKS, TICKERS } from "../lib/stocks";
import type { BoardPayload, TickerReport } from "../lib/types";
import type { ReplayFixture } from "../lib/replay";

process.loadEnvFile?.(".env.local");
const BASE = process.argv[2] ?? "https://wick-wire.vercel.app";
type R = "PASS" | "WARN" | "FAIL";
const results: { area: string; check: string; r: R; detail: string }[] = [];
const rec = (area: string, check: string, r: R, detail = "") => results.push({ area, check, r, detail });
const near = (a: number, b: number, tolPct: number) => Math.abs(a - b) / Math.abs(b || 1) * 100 <= tolPct;
const j = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json() as Promise<T>;
};
const ET = (s: string) => Date.parse(s) / 1000;

// ---------------- A. pure logic ----------------
function unit() {
  const A = "A · logic";
  const cases: [string, string][] = [
    ["2026-09-25T14:00:00-04:00", "OPEN"], ["2026-09-25T17:00:00-04:00", "WEEKEND"], ["2026-09-26T12:00:00-04:00", "WEEKEND"],
    ["2026-09-22T02:00:00-04:00", "OVERNIGHT"], ["2026-09-22T18:00:00-04:00", "AFTER-HOURS"], ["2026-09-07T12:00:00-04:00", "WEEKEND"],
    ["2026-09-24T09:29:00-04:00", "OVERNIGHT"], ["2026-09-24T09:30:00-04:00", "OPEN"], ["2026-09-24T16:00:00-04:00", "AFTER-HOURS"],
  ];
  for (const [t, want] of cases) {
    const got = marketState(Date.parse(t));
    rec(A, `market state ${t}`, got === want ? "PASS" : "FAIL", `${got} (want ${want})`);
  }
  rec(A, "Labor Day 7 Sep closed → next open Tue 8 Sep 9:30", nextOpen(Date.parse("2026-09-07T12:00:00-04:00")) === Date.parse("2026-09-08T09:30:00-04:00") ? "PASS" : "FAIL");
  rec(A, "Early close 27 Nov 13:00 is the last close", lastClose(Date.parse("2026-11-27T15:00:00-05:00")) === Date.parse("2026-11-27T13:00:00-05:00") ? "PASS" : "FAIL");

  const base = (over: Partial<TickerReport>): TickerReport =>
    ({ gapPct: 1.5, driver: { news: 0.2, onchain: 0.5, unexplained: 0.3 }, headlines: [], thin: { impactPct: 0.3, route: "x" }, pools: [], ...over }) as unknown as TickerReport;
  const ok = { ok: true, label: "ok" }, thin = { ok: false, label: "thin" };
  const sc = (p: number) => [{ score: { caused_move: p } }] as unknown as TickerReport["headlines"];
  const sig = (r: TickerReport, d = ok) => { const s = signalFor(r, d); return `${s.signal}${s.side ? "·" + s.side : ""}`; };
  const expect = (name: string, got: string, want: string) => rec(A, `signal: ${name}`, got === want ? "PASS" : "FAIL", `${got} (want ${want})`);
  expect("0.2% gap, strong news → NO TRADE", sig(base({ gapPct: 0.2, driver: { news: 0.8, onchain: 0.1, unexplained: 0.1 }, headlines: sc(0.7) })), "NO TRADE");
  expect("1.5% gap, strong news → RESPECT", sig(base({ driver: { news: 0.7, onchain: 0.1, unexplained: 0.2 }, headlines: sc(0.6) })), "RESPECT");
  expect("news share high but no headline ≥ 0.4 → not RESPECT", sig(base({ driver: { news: 0.6, onchain: 0.1, unexplained: 0.3 }, headlines: sc(0.3) })), "NO TRADE");
  expect("−1.5% on-chain, depth ok → FADE·BUY", sig(base({ gapPct: -1.5 })), "FADE·BUY");
  expect("+1.5% unexplained → FADE·SELL", sig(base({ driver: { news: 0.1, onchain: 0.1, unexplained: 0.8 } })), "FADE·SELL");
  expect("+1.5% on-chain but thin → NO TRADE", sig(base({}), thin), "NO TRADE");
  expect("mixed evidence → NO TRADE", sig(base({ driver: { news: 0.45, onchain: 0.25, unexplained: 0.3 } })), "NO TRADE");
  expect("unscored → NO TRADE", sig(base({ driver: null })), "NO TRADE");

  // backtest math: buy at 99 vs close 100, exit 100 → +1.0101% gross, −0.5% fees
  const r = { ...base({ gapPct: -1, driver: { news: 0.1, onchain: 0.6, unexplained: 0.3 } }), reference: { price: 100 }, tokenPrice: { price: 99 }, pools: [{ paired: false, liquidityUsd: 1e6 }], ticker: "T" } as unknown as TickerReport;
  const b = backtestRow(r, 100, "t");
  rec(A, "backtest: fade buy 99→100 net", b.netPct != null && Math.abs(b.netPct - (1 / 99 * 100 - 2 * FEE_PER_SIDE_PCT)) < 1e-9 ? "PASS" : "FAIL", `${b.signal} ${b.side} net ${b.netPct?.toFixed(4)}%`);
  rec(A, "backtest: gap fully closed = 100%", b.gapClosedPct != null && Math.abs(b.gapClosedPct - 100) < 1e-9 ? "PASS" : "FAIL", `${b.gapClosedPct}`);

  const s = sanitize(
    { scores: [{ ref: "N1", caused_move: 1.4, category: "Legal/Regulatory", importance: 140 }, { ref: "ZZ", caused_move: 0.5, category: "other", importance: 1 }], driver: { news: 2, onchain: 1, unexplained: 1 }, alert_holders: { yes: false, confidence: 0.2 }, reason: "r", explanation: [{ text: "a", ref: "N1" }, { text: "b", ref: "Q9" }] },
    new Set(["N1"]),
  );
  rec(A, "sanitize: clamps, maps category, drops unknown refs, normalises driver",
    s.scores.length === 1 && s.scores[0].caused_move === 1 && s.scores[0].importance === 100 && s.scores[0].category === "legal_regulatory" && Math.abs(s.driver.news - 0.5) < 1e-9 && s.explanation[1].ref === null ? "PASS" : "FAIL");
}

// ---------------- B. production live data ----------------
async function yahooDaily(t: string, from: number, to: number) {
  const r = await j<any>(`https://query1.finance.yahoo.com/v8/finance/chart/${t}?period1=${from}&period2=${to}&interval=1d`, { headers: { "user-agent": "Mozilla/5.0" } });
  const res = r.chart.result[0];
  return new Map<string, number>((res.timestamp as number[]).map((ts, i) => [new Date(ts * 1000).toLocaleDateString("en-CA", { timeZone: "America/New_York" }), res.indicators.quote[0].close[i]]));
}
const etDate = (sec: number) => new Date(sec * 1000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

async function live() {
  const B = "B · live";
  for (const p of ["/", "/desk", "/stock/NVDA", "/?mode=replay", "/stock/SPY?mode=replay", "/api/market", "/api/prices", "/api/backtest", "/api/track", "/api/events", "/api/chart/NVDA?res=15"]) {
    const t0 = Date.now();
    const r = await fetch(BASE + p, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
    rec(B, `GET ${p}`, r?.ok ? "PASS" : "FAIL", `${r?.status ?? "no response"} · ${Date.now() - t0} ms`);
  }
  const market = await j<BoardPayload["market"]>(BASE + "/api/market");
  rec(B, "market state matches local clock", market.state === marketState() ? "PASS" : "FAIL", `${market.state}`);
  const prices = (await j<{ prices: Record<string, number> }>(BASE + "/api/prices")).prices;
  const years = await Promise.all(TICKERS.map((t) => yahooDaily(t, Math.floor(Date.now() / 1000) - 10 * 86400, Math.floor(Date.now() / 1000)).catch(() => null)));
  for (const [i, t] of TICKERS.entries()) {
    const r = await j<TickerReport>(`${BASE}/api/stock/${t}`);
    const ref = r.reference?.price, tok = r.tokenPrice?.price;
    if (ref && tok && r.gapPct != null) rec(B, `${t} gap = (token − ref)/ref`, Math.abs((tok - ref) / ref * 100 - r.gapPct) < 1e-9 ? "PASS" : "FAIL", `${r.gapPct.toFixed(3)}%`);
    else rec(B, `${t} gap computable`, "FAIL", r.unavailable.join("; "));
    // Reference = the real close of the last trading day (Yahoo daily close, same date).
    const lc = Math.floor(lastClose() / 1000);
    const yc = years[i]?.get(etDate(lc));
    if (ref && yc) rec(B, `${t} last close vs Yahoo ${etDate(lc)}`, near(ref, yc, 0.3) ? "PASS" : "FAIL", `ours ${ref.toFixed(2)} (${r.reference!.source}) · Yahoo ${yc.toFixed(2)}`);
    else rec(B, `${t} last close vs Yahoo`, "WARN", "Yahoo unavailable");
    // Token price vs an independent DEX quote (main USDC pool on DexScreener) and our live price feed.
    const ds = await j<any[]>(`https://api.dexscreener.com/token-pairs/v1/solana/${STOCKS[t].mint}`).catch(() => []);
    const main = ds.filter((p) => p.baseToken.address === STOCKS[t].mint && p.quoteToken.symbol === "USDC").sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    if (tok && main) rec(B, `${t} token price vs DexScreener main pool`, near(tok, Number(main.priceUsd), 1) ? "PASS" : "WARN", `ours ${tok.toFixed(2)} · pool ${Number(main.priceUsd).toFixed(2)} (report cached ${Math.round((Date.now() - r.generatedAt) / 60000)} min)`);
    if (prices[t] && main) rec(B, `${t} live Jupiter price vs DexScreener`, near(prices[t], Number(main.priceUsd), 0.5) ? "PASS" : "WARN", `${prices[t].toFixed(2)} vs ${Number(main.priceUsd).toFixed(2)}`);
    // Headlines inside the window, ≤ 15, unique.
    const out = r.headlines.filter((h) => h.time < r.window.from || h.time > r.window.to + 60);
    rec(B, `${t} headlines inside window (${r.headlines.length})`, out.length === 0 ? "PASS" : "FAIL", out.map((h) => h.title.slice(0, 40)).join(" | "));
    rec(B, `${t} headlines unique`, new Set(r.headlines.map((h) => h.url)).size === r.headlines.length ? "PASS" : "FAIL");
    // Scores sane; driver sums to 1; flag consistent.
    const bad = [...r.headlines, ...r.onchain].filter((e) => e.score && (e.score.caused_move < 0 || e.score.caused_move > 1 || e.score.importance < 0 || e.score.importance > 100));
    rec(B, `${t} scores within range`, bad.length ? "FAIL" : "PASS");
    if (r.driver) rec(B, `${t} driver sums to 100%`, Math.abs(r.driver.news + r.driver.onchain + r.driver.unexplained - 1) < 1e-6 ? "PASS" : "FAIL");
    // Explanation must not invent numbers: every % in reason/explanation should match an input number.
    const text = `${r.reason ?? ""} ${r.explanation.map((s) => s.text).join("")}`;
    const nums = [...text.matchAll(/([−-]?\d+(?:\.\d+)?)\s?%/g)].map((m) => Math.abs(Number(m[1].replace("−", "-"))));
    const inputs = [r.gapPct, ...r.cross.map((c) => c.pct), r.thin?.impactPct, r.driver?.news! * 100, r.driver?.onchain! * 100]
      .filter((x): x is number => x != null && Number.isFinite(x)).map(Math.abs)
      .concat(...[...r.headlines.map((h) => h.title), ...r.onchain.map((e) => e.title + " " + e.detail)].map((s) => [...s.matchAll(/(\d+(?:\.\d+)?)\s?%/g)].map((m) => Number(m[1]))));
    const orphan = nums.filter((n) => !inputs.some((x) => Math.abs(x - n) <= Math.max(0.06, n * 0.05)));
    rec(B, `${t} explanation numbers traceable to inputs`, orphan.length ? "WARN" : "PASS", orphan.length ? `unmatched: ${orphan.join(", ")}% in "${text.slice(0, 90)}…"` : `${nums.length} numbers checked`);
    // Liquidity of main pool vs DexScreener now.
    const ourMain = r.pools.find((p) => !p.paired);
    if (ourMain && main) rec(B, `${t} main pool liquidity vs DexScreener`, near(ourMain.liquidityUsd, main.liquidity.usd, 15) ? "PASS" : "WARN", `${Math.round(ourMain.liquidityUsd)} vs ${Math.round(main.liquidity.usd)}`);
    if (i === 0) {
      // Cross-asset BTC change vs Binance hourly klines over the same window.
      const btc = r.cross.find((c) => c.key === "BTC")?.pct;
      const k = await j<any[]>(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=${r.window.from * 1000}&limit=1`).catch(() => []);
      const k2 = await j<any[]>(`https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT`).catch(() => null) as unknown as { price: string } | null;
      if (btc != null && k[0] && k2) {
        const bn = (Number(k2.price) / Number(k[0][1]) - 1) * 100;
        rec(B, "BTC change (Pyth) vs Binance", Math.abs(bn - btc) < 0.35 ? "PASS" : "WARN", `Pyth ${btc.toFixed(2)}% · Binance ${bn.toFixed(2)}% (report cached ${Math.round((Date.now() - r.generatedAt) / 60000)} min)`);
      } else rec(B, "BTC change (Pyth) vs Binance", "WARN", "unavailable");
    }
  }
}

// ---------------- C. replay fixture ----------------
async function replay() {
  const C = "C · replay";
  const fx = JSON.parse(readFileSync("data/replay/2026-09-20.json", "utf8")) as ReplayFixture;
  const FROM = ET("2026-09-18T16:00:00-04:00"), TO = ET("2026-09-20T20:00:00-04:00");
  for (const r of fx.board.reports) {
    const y = await yahooDaily(r.ticker, FROM - 3 * 86400, FROM + 4 * 86400).catch(() => null);
    const yc = y?.get("2026-09-18");
    if (yc && r.reference) rec(C, `${r.ticker} Fri 18 Sep close vs Yahoo`, near(r.reference.price, yc, 0.3) ? "PASS" : "FAIL", `ours ${r.reference.price.toFixed(2)} (${r.reference.source}) · Yahoo ${yc.toFixed(2)}`);
    const h = fx.charts[r.ticker]?.["60"]?.candles ?? [];
    const last = h.filter((c) => c.t <= TO).at(-1);
    rec(C, `${r.ticker} Sun 8 PM token price = pool candle close`, last && r.tokenPrice && Math.abs(last.c - r.tokenPrice.price) < 1e-9 ? "PASS" : "FAIL", `${r.tokenPrice?.price.toFixed(2)}`);
    const out = r.headlines.filter((x) => x.time < FROM || x.time > TO);
    rec(C, `${r.ticker} headlines inside the weekend (${r.headlines.length})`, out.length ? "FAIL" : "PASS", out.map((x) => new Date(x.time * 1000).toISOString()).join(", "));
    if (r.gapPct != null && r.reference && r.tokenPrice) rec(C, `${r.ticker} gap math`, Math.abs((r.tokenPrice.price - r.reference.price) / r.reference.price * 100 - r.gapPct) < 1e-9 ? "PASS" : "FAIL");
  }
  const bt = fx.backtest!;
  for (const b of bt.rows) {
    const rep = fx.board.reports.find((x) => x.ticker === b.ticker)!;
    const fresh = backtestRow(rep, b.exit, b.exitSource);
    rec(C, `${b.ticker} backtest row reproducible (${b.signal})`, JSON.stringify(fresh) === JSON.stringify(b) ? "PASS" : "FAIL");
  }
  const blind = bt.rows.reduce((s, r) => s + (r.fadeAnywayNetPct ?? 0) * 10, 0);
  rec(C, "if-faded-anyway total ($1k each)", "PASS", `${blind >= 0 ? "+" : "−"}$${Math.abs(blind).toFixed(2)} · lost on ${bt.rows.filter((r) => (r.fadeAnywayNetPct ?? 0) < 0).length}/8`);
}

// ---------------- D. server scanner ----------------
async function server() {
  const D = "D · scanner";
  const url = process.env.WORKER_URL ?? "http://13.205.105.48:7910", token = process.env.WORKER_TOKEN;
  if (!token) return rec(D, "worker token available", "WARN", "set WORKER_TOKEN to test the server directly");
  const h = await j<{ ok: boolean }>(url + "/health").catch(() => null);
  rec(D, "health", h?.ok ? "PASS" : "FAIL");
  const noAuth = await fetch(url + "/track").then((r) => r.status).catch(() => 0);
  rec(D, "API refuses requests without token", noAuth === 401 ? "PASS" : "FAIL", String(noAuth));
  const t = await j<any>(url + "/track", { headers: { authorization: `Bearer ${token}` } });
  const age = (Date.now() - t.lastScan.at) / 60000;
  rec(D, "last scan recent (≤ 20 min)", age <= 20 ? "PASS" : "FAIL", `${age.toFixed(1)} min ago · ${t.lastScan.ok} ok / ${t.lastScan.failed} failed`);
  const tr = t.trades as any[];
  rec(D, "totals: open + closed = trades", t.totals.open + t.totals.closed === t.totals.trades ? "PASS" : "FAIL");
  rec(D, "totals: net = Σ closed trades", Math.abs(t.totals.netUsd - tr.filter((x) => x.status === "closed").reduce((s, x) => s + x.net_usd, 0)) < 1e-6 ? "PASS" : "FAIL");
  for (const x of tr) {
    rec(D, `trade #${x.id} ${x.ticker} ${x.side}: qty × entry = $1,000`, Math.abs(x.qty * x.entry - 1000) < 1e-6 ? "PASS" : "FAIL", `${x.qty.toFixed(4)} × ${x.entry.toFixed(2)}`);
    rec(D, `trade #${x.id} settles at the next NYSE open after entry`, x.settle_at * 1000 === nextOpen(x.opened_at * 1000) ? "PASS" : "FAIL", new Date(x.settle_at * 1000).toISOString());
    if (x.status === "closed") {
      const g = x.side === "BUY" ? (x.exit - x.entry) / x.entry : (x.entry - x.exit) / x.entry;
      rec(D, `trade #${x.id} net = gross − 2×fees`, Math.abs(g * 100 - 2 * FEE_PER_SIDE_PCT - x.net_pct) < 1e-9 ? "PASS" : "FAIL", `${x.net_pct.toFixed(3)}% = $${x.net_usd.toFixed(2)}`);
    }
  }
  for (const c of t.calls as any[]) rec(D, `RESPECT call #${c.id} ${c.ticker} had |gap| ≥ 1%`, Math.abs(c.gap_pct) >= 1 ? "PASS" : "FAIL", `${c.gap_pct.toFixed(2)}%`);
  const e = await j<{ events: { id: number }[] }>(url + "/events", { headers: { authorization: `Bearer ${token}` } });
  rec(D, "event log readable", e.events.length > 0 ? "PASS" : "WARN", `${e.events.length} latest events`);
}

(async () => {
  unit();
  for (const [name, fn] of [["live", live], ["replay", replay], ["server", server]] as const) {
    try { await fn(); } catch (e) { rec(name, "suite crashed", "FAIL", (e as Error).message); }
  }
  const w = Math.max(...results.map((r) => r.check.length));
  for (const r of results) console.log(`${r.r === "PASS" ? "✅" : r.r === "WARN" ? "⚠️ " : "❌"} ${r.area.padEnd(12)} ${r.check.padEnd(w)}  ${r.detail}`);
  const c = (k: R) => results.filter((r) => r.r === k).length;
  console.log(`\n${c("PASS")} pass · ${c("WARN")} warn · ${c("FAIL")} fail`);
})();
