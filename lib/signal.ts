// Gap signal (paper only, never executes): should you trust this off-hours gap or fade it?
//  FADE     — |gap| ≥ 1%, the move is mostly on-chain / unexplained, and there is enough depth → expect it to close at the open
//  RESPECT  — the move is explained by news (driver.news ≥ 0.5 and a headline with caused_move ≥ 0.4) → likely a real repricing
//  NO TRADE — gap too small, too thin to trade, or mixed evidence
import type { TickerReport } from "./types";

export type Signal = "FADE" | "RESPECT" | "NO TRADE";
export type SignalResult = { signal: Signal; side: "BUY" | "SELL" | null; why: string };

export const MIN_GAP_PCT = 1;
export const MAX_IMPACT_PCT = 1; // $1,000 Jupiter quote
export const MIN_REPLAY_LIQ_USD = 250_000; // replay depth proxy (no historical quotes)
export const FEE_PER_SIDE_PCT = 0.25; // assumed DEX/LP fee per side, on top of price impact

export function signalFor(r: TickerReport, depth: { ok: boolean; label: string }): SignalResult {
  const gap = r.gapPct;
  if (gap == null) return { signal: "NO TRADE", side: null, why: "price unavailable" };
  if (!r.driver) return { signal: "NO TRADE", side: null, why: "move not scored" };
  const topNews = Math.max(0, ...r.headlines.map((h) => h.score?.caused_move ?? 0));
  if (r.driver.news >= 0.5 && topNews >= 0.4) return { signal: "RESPECT", side: null, why: `news explains it (news ${Math.round(r.driver.news * 100)}%, top headline ${Math.round(topNews * 100)}%)` };
  if (Math.abs(gap) < MIN_GAP_PCT) return { signal: "NO TRADE", side: null, why: `gap under ${MIN_GAP_PCT}%` };
  if (!depth.ok) return { signal: "NO TRADE", side: null, why: `too thin: ${depth.label}` };
  if (r.driver.onchain + r.driver.unexplained >= 0.5)
    return {
      signal: "FADE",
      side: gap < 0 ? "BUY" : "SELL",
      why: `on-chain/unexplained ${Math.round((r.driver.onchain + r.driver.unexplained) * 100)}% · ${depth.label}`,
    };
  return { signal: "NO TRADE", side: null, why: "mixed evidence" };
}

/** Live depth: the real $1,000 Jupiter quote. */
export function liveDepth(r: TickerReport) {
  if (!r.thin) return { ok: false, label: "Jupiter quote unavailable" };
  return { ok: r.thin.impactPct <= MAX_IMPACT_PCT, label: `$1k impact ${r.thin.impactPct.toFixed(2)}%` };
}

/** Replay depth proxy: main-pool liquidity as recorded (historical quotes don't exist). */
export function replayDepth(r: TickerReport) {
  const main = r.pools.find((p) => !p.paired);
  if (!main) return { ok: false, label: "no main pool" };
  return { ok: main.liquidityUsd >= MIN_REPLAY_LIQ_USD, label: `main pool liq $${(main.liquidityUsd / 1e6).toFixed(2)}M` };
}

export type BacktestRow = {
  ticker: string;
  signal: Signal;
  side: "BUY" | "SELL" | null;
  why: string;
  refClose: number | null; // Friday close
  entry: number | null; // token, Sun 20:00 ET
  exit: number | null; // token, Mon 09:30 ET (first 15-min candle open)
  exitSource: string;
  gapClosedPct: number | null; // share of the Sunday gap that closed by Monday's open
  grossPct: number | null; // paper return of the signal's side (FADE only)
  costPct: number | null; // 2 × fee (price impact not recorded for replay → fee only, stated)
  netPct: number | null;
  fadeAnywayNetPct: number | null; // what fading would have returned regardless of the signal (after fees)
};

export function backtestRow(r: TickerReport, exit: number | null, exitSource: string): BacktestRow {
  const s = signalFor(r, replayDepth(r));
  const ref = r.reference?.price ?? null, entry = r.tokenPrice?.price ?? null;
  const gapClosed = ref && entry && exit && entry !== ref ? ((entry - exit) / (entry - ref)) * 100 : null;
  let gross: number | null = null;
  if (s.side && entry && exit) gross = s.side === "BUY" ? ((exit - entry) / entry) * 100 : ((entry - exit) / entry) * 100;
  const cost = s.side ? 2 * FEE_PER_SIDE_PCT : null;
  return {
    ticker: r.ticker,
    signal: s.signal,
    side: s.side,
    why: s.why,
    refClose: ref,
    entry,
    exit,
    exitSource,
    gapClosedPct: gapClosed,
    grossPct: gross,
    costPct: cost,
    netPct: gross != null && cost != null ? gross - cost : null,
    fadeAnywayNetPct:
      ref && entry && exit && entry !== ref
        ? (entry < ref ? ((exit - entry) / entry) * 100 : ((entry - exit) / entry) * 100) - 2 * FEE_PER_SIDE_PCT
        : null,
  };
}
