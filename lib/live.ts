// Live reports for the Vercel app. If a scanner worker is configured (WORKER_URL), read its latest
// reports (one scanner for everyone, no duplicate LLM spend); otherwise build locally with caching.
import { unstable_cache } from "next/cache";
import { boardFrom } from "./board";
import { cached } from "./cache";
import { marketClock } from "./market-hours";
import { LIVE_TTL, buildLive } from "./pipeline";
import { TICKERS, type Ticker } from "./stocks";
import type { BoardPayload, TickerReport } from "./types";

export async function worker<T>(path: string): Promise<T | null> {
  const base = process.env.WORKER_URL, token = process.env.WORKER_TOKEN;
  if (!base || !token) return null;
  try {
    const r = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

const sharedLive = unstable_cache(buildLive, ["report-live-v2"], { revalidate: LIVE_TTL / 1000 });

export async function liveReport(ticker: Ticker): Promise<TickerReport> {
  const fromWorker = await worker<TickerReport>(`/report/${ticker}`);
  if (fromWorker) return fromWorker;
  return cached(`report:live:${ticker}`, LIVE_TTL, async () => {
    try {
      return await sharedLive(ticker);
    } catch {
      return buildLive(ticker);
    }
  });
}

export async function liveBoard(): Promise<BoardPayload> {
  const reports = await Promise.all(TICKERS.map((t) => liveReport(t)));
  const c = marketClock();
  return boardFrom(reports, "live", { state: c.state, lastClose: c.lastClose, nextOpen: c.nextOpen }, null);
}
