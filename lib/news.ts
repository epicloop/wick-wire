// Finnhub (free key — use sparingly): company news in a window, and the last regular price (/quote).
import { z } from "zod";
import { cached } from "./cache";

const FH = "https://finnhub.io/api/v1";

export type Headline = { id: string; title: string; source: string; url: string; time: number; summary: string };

const NewsItem = z.object({
  id: z.number().optional(),
  headline: z.string(),
  source: z.string(),
  datetime: z.number(),
  url: z.string(),
  summary: z.string().optional().default(""),
});

const ymd = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);

async function fh(path: string) {
  const key = process.env.FINNHUB_KEY;
  if (!key) throw new Error("FINNHUB_KEY not set");
  const r = await fetch(`${FH}${path}&token=${key}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`finnhub ${r.status}`);
  return r.json();
}

/** Headlines published in [fromSec, toSec], deduped by URL/title, newest first, max 15. */
export async function headlines(ticker: string, fromSec: number, toSec: number, keywords: RegExp | null, ttlMs = 30 * 60_000): Promise<Headline[]> {
  // Round the window so repeat requests inside the TTL share one cache entry.
  const to = Math.ceil(toSec / 1800) * 1800;
  return cached(`fh:news:${ticker}:${fromSec}:${to}`, ttlMs, async () => {
    const raw = z.array(NewsItem).parse(await fh(`/company-news?symbol=${ticker}&from=${ymd(fromSec - 86400)}&to=${ymd(toSec)}`));
    const seen = new Set<string>();
    return raw
      .filter((n) => n.datetime >= fromSec && n.datetime <= toSec)
      // Finnhub "company news" includes loosely related stories: keep only ones about this company.
      .filter((n) => !keywords || keywords.test(n.headline) || keywords.test(n.summary.slice(0, 200)))
      .filter((n) => {
        const k = n.headline.toLowerCase().replace(/\W+/g, " ").trim();
        if (seen.has(k) || seen.has(n.url)) return false;
        seen.add(k).add(n.url);
        return true;
      })
      .sort((a, b) => b.datetime - a.datetime)
      .slice(0, 15)
      .map((n) => ({ id: String(n.id ?? n.url), title: n.headline, source: n.source, url: n.url, time: n.datetime, summary: n.summary.slice(0, 280) }));
  });
}

const Quote = z.object({ c: z.number(), pc: z.number(), t: z.number() });

/** Finnhub regular-session quote: `c` = last regular price (= the close once the session ended), `t` = its time. */
export async function quote(ticker: string) {
  return cached(`fh:quote:${ticker}`, 5 * 60_000, async () => {
    const q = Quote.parse(await fh(`/quote?symbol=${ticker}`));
    if (!q.c || !q.t) return null;
    return { price: q.c, prevClose: q.pc, time: q.t };
  }).catch(() => null);
}
