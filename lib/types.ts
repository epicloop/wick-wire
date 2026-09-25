import type { MarketState } from "./market-hours";
import type { OnchainEvent, Pool } from "./onchain";
import type { Candle } from "./pyth";
import type { Category, ScoreMeta } from "./scorer/types";

export type Mode = "live" | "replay";
export type Source = "pyth" | "finnhub" | "yahoo" | "jupiter" | "geckoterminal" | "dexscreener";

export type PricePoint = { price: number; time: number; source: Source; label: string };

export type Score = { caused_move: number; category: Category; importance: number };

export type HeadlineRow = { ref: string; title: string; source: string; url: string; time: number; score: Score | null };
export type OnchainRow = OnchainEvent & { score: Score | null };

export type Flag = "NEWS" | "ON-CHAIN" | "NEWS + ON-CHAIN" | "UNEXPLAINED" | "UNSCORED";

export type CrossRow = { key: "XAU" | "BTC" | "EURUSD"; label: string; pct: number | null };

export type TickerReport = {
  ticker: string;
  token: string;
  name: string;
  mint: string;
  mode: Mode;
  window: { from: number; to: number; label: string };
  reference: PricePoint | null; // last real close (or live NYSE price while OPEN)
  tokenPrice: PricePoint | null;
  gapPct: number | null;
  wick: { lo: number; hi: number } | null; // token range over the window
  thin: { impactPct: number; route: string } | null;
  headlines: HeadlineRow[];
  onchain: OnchainRow[];
  tradesAvailable: boolean;
  driver: { news: number; onchain: number; unexplained: number } | null;
  flag: Flag;
  categoryLabel: string;
  alert: { yes: boolean; confidence: number } | null;
  reason: string | null;
  explanation: { text: string; ref: string | null }[];
  pools: Pool[];
  supply: number | null;
  cross: CrossRow[];
  scorer: (ScoreMeta & { name: string }) | null;
  unavailable: string[]; // human-readable list of sources that failed
  generatedAt: number;
};

export type WireItem = { ticker: string; time: number; kind: "NEWS" | "ON-CHAIN"; title: string; source: string; url: string; p: number | null };

export type BoardPayload = {
  mode: Mode;
  generatedAt: number;
  market: { state: MarketState; lastClose: number; nextOpen: number | null };
  replayLabel: string | null;
  reports: TickerReport[];
  wire: WireItem[];
  backtest?: { exitLabel: string; rows: import("./signal").BacktestRow[]; generatedAt: number };
  stats: { headlines: number; onchainEvents: number; llmCalls: number; llmCostUsd: number; p50Ms: number | null; scorer: string };
};

export type ChartPayload = { resolution: 5 | 15 | 60; source: Source; candles: Candle[] };
