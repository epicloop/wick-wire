// Pure helpers (safe for the browser): combine per-ticker reports into the board payload.
import type { BoardPayload, Mode, TickerReport, WireItem } from "./types";

export function wireFrom(reports: TickerReport[]): WireItem[] {
  return reports
    .flatMap((r) => [
      ...r.headlines.map((h) => ({ ticker: r.ticker, time: h.time, kind: "NEWS" as const, title: h.title, source: h.source, url: h.url, p: h.score?.caused_move ?? null })),
      // Timed on-chain events only; "now/24h" pool snapshots live on the stock page.
      ...r.onchain.filter((e) => e.kind === "whale_trade" || e.kind === "volume_spike").map((e) => ({ ticker: r.ticker, time: e.time, kind: "ON-CHAIN" as const, title: e.title, source: e.detail, url: e.link, p: e.score?.caused_move ?? null })),
    ])
    .filter((w) => w.p == null || w.p >= 0.05)
    .sort((a, b) => b.time - a.time)
    .slice(0, 30);
}

export function boardFrom(reports: TickerReport[], mode: Mode, market: BoardPayload["market"], replayLabel: string | null): BoardPayload {
  const scored = reports.filter((r) => r.scorer);
  const lat = scored.map((r) => r.scorer!.latencyMs).sort((a, b) => a - b);
  return {
    mode,
    generatedAt: Date.now(),
    market,
    replayLabel,
    reports,
    wire: wireFrom(reports),
    stats: {
      headlines: reports.reduce((s, r) => s + r.headlines.length, 0),
      onchainEvents: reports.reduce((s, r) => s + r.onchain.length, 0),
      llmCalls: scored.length,
      llmCostUsd: scored.reduce((s, r) => s + r.scorer!.costUsd, 0),
      p50Ms: lat.length ? lat[Math.floor(lat.length / 2)] : null,
      scorer: scored[0]?.scorer?.name ?? "Claude Haiku 4.5",
    },
  };
}

