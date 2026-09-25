// Finnhub (free key — use sparingly): company news in a window, and the last regular price (/quote).
import { z } from "zod";
import { cached, throttle } from "./cache";

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

const fhSlot = throttle(400); // free key: one request at a time, gently spaced

async function fh(path: string, timeoutMs = 15_000, retries = 2) {
  const key = process.env.FINNHUB_KEY;
  if (!key) throw new Error("FINNHUB_KEY not set");
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fhSlot(() => fetch(`${FH}${path}&token=${key}`, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) }));
      if (r.status === 429 && attempt < retries) {
        await new Promise((res) => setTimeout(res, 3000));
        continue;
      }
      if (!r.ok) throw new Error(`finnhub ${r.status}`);
      return r.json();
    } catch (e) {
      if (attempt >= retries || (e as Error).message.startsWith("finnhub ") || (e as Error).name === "TimeoutError") throw e;
      await new Promise((res) => setTimeout(res, 1500));
    }
  }
}

const keep = (keywords: RegExp | null) => (h: Headline) => !keywords || keywords.test(h.title) || keywords.test(h.summary.slice(0, 200));

function dedupe(items: Headline[]) {
  const seen = new Set<string>();
  return items.filter((n) => {
    const k = n.title.toLowerCase().replace(/\W+/g, " ").trim();
    if (seen.has(k) || seen.has(n.url)) return false;
    seen.add(k).add(n.url);
    return true;
  });
}

async function finnhubNews(ticker: string, fromSec: number, toSec: number): Promise<Headline[]> {
  const raw = z.array(NewsItem).parse(await fh(`/company-news?symbol=${ticker}&from=${ymd(fromSec - 86400)}&to=${ymd(toSec)}`, 6_000, 0));
  return raw.map((n) => ({ id: String(n.id ?? n.url), title: n.headline, source: n.source, url: n.url, time: n.datetime, summary: n.summary.slice(0, 280) }));
}

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

/** Fallback: Google News RSS search (no key). Each item keeps its real publisher. */
async function googleNews(query: string, fromSec: number, toSec?: number): Promise<Headline[]> {
  const days = Math.max(1, Math.ceil((Date.now() / 1000 - fromSec) / 86400) + 1);
  // Historical windows use after:/before: (dates, UTC); live uses when:Nd.
  const q = toSec ? `${query} after:${ymd(fromSec - 86400)} before:${ymd(toSec + 86400)}` : `${query} when:${days}d`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`google news ${r.status}`);
  const xml = await r.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([, it]) => {
    const tag = (t: string) => decode(it.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1] ?? "");
    const source = tag("source") || "Google News";
    const title = tag("title").replace(new RegExp(`\\s+-\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "");
    const time = Math.floor(Date.parse(tag("pubDate")) / 1000);
    const link = tag("link");
    return title && link && Number.isFinite(time) ? [{ id: link, title, source, url: link, time, summary: "" }] : [];
  });
}

/** Headlines published in [fromSec, toSec] about this company: Finnhub first, Google News RSS fallback.
 *  Deduped by URL/title, newest first, max 15. */
export async function headlines(
  ticker: string,
  query: string,
  fromSec: number,
  toSec: number,
  keywords: RegExp | null,
  ttlMs = 30 * 60_000,
): Promise<{ items: Headline[]; via: "finnhub" | "google-news" }> {
  // Round the window so repeat requests inside the TTL share one cache entry.
  const to = Math.ceil(toSec / 1800) * 1800;
  return cached(`news:${ticker}:${fromSec}:${to}`, ttlMs, async () => {
    const pick = (xs: Headline[]) =>
      dedupe(xs.filter((n) => n.time >= fromSec && n.time <= toSec).filter(keep(keywords)))
        .sort((a, b) => b.time - a.time)
        .slice(0, 15);
    try {
      const items = pick(await finnhubNews(ticker, fromSec, toSec));
      if (items.length) return { items, via: "finnhub" as const };
    } catch (e) {
      console.warn(`[news] finnhub ${ticker}:`, (e as Error).message);
    }
    const historical = toSec < Date.now() / 1000 - 6 * 3600;
    return { items: pick(await googleNews(query, fromSec, historical ? toSec : undefined)), via: "google-news" as const };
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
