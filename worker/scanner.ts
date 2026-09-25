// Wick Wire scanner worker — runs on our own server (AWS Lightsail), 24/7.
// Every SCAN_MINUTES it builds live reports for the 8 xStocks, logs new headlines / on-chain events / signal
// changes, opens PAPER positions on FADE signals, records RESPECT calls, and settles both at the next NYSE open
// using the real token price then. State lives in a local SQLite file. Paper only: nothing is ever executed.
// It also serves a small read-only JSON API (bearer token) that the Vercel app reads.
//
//   build:  npm run build:worker   → dist/scanner.mjs
//   run:    node --env-file=.env dist/scanner.mjs
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { boardFrom } from "../lib/board";
import { marketClock, nextOpen } from "../lib/market-hours";
import { poolCandles } from "../lib/onchain";
import { buildLive } from "../lib/pipeline";
import { FEE_PER_SIDE_PCT, liveDepth, signalFor } from "../lib/signal";
import { STOCKS, TICKERS, isTicker, type Ticker } from "../lib/stocks";
import { stats } from "../lib/stats";
import type { TickerReport } from "../lib/types";

const PORT = Number(process.env.WORKER_PORT ?? 7910);
const TOKEN = process.env.WORKER_TOKEN ?? "";
const SCAN_MS = Number(process.env.SCAN_MINUTES ?? 15) * 60_000;
const DB_FILE = process.env.WORKER_DB ?? "wick-wire.db";
const STAKE = 1000;
if (TOKEN.length < 24) throw new Error("WORKER_TOKEN missing or too short");

const db = new DatabaseSync(DB_FILE);
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS reports (ticker TEXT PRIMARY KEY, at INTEGER NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, ticker TEXT NOT NULL,
  kind TEXT NOT NULL, title TEXT NOT NULL, sub TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', side TEXT, hash TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS signals (ticker TEXT PRIMARY KEY, signal TEXT NOT NULL, side TEXT, why TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS trades (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT NOT NULL, side TEXT NOT NULL,
  opened_at INTEGER NOT NULL, entry REAL NOT NULL, entry_impact REAL, qty REAL NOT NULL, ref_close REAL, gap_pct REAL, why TEXT,
  settle_at INTEGER NOT NULL, closed_at INTEGER, exit REAL, exit_source TEXT, net_pct REAL, net_usd REAL, status TEXT NOT NULL DEFAULT 'open');
CREATE TABLE IF NOT EXISTS calls (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT NOT NULL, window_from INTEGER NOT NULL,
  at INTEGER NOT NULL, price REAL NOT NULL, ref_close REAL NOT NULL, gap_pct REAL NOT NULL, why TEXT, settle_at INTEGER NOT NULL,
  open_price REAL, held INTEGER, checked_at INTEGER, UNIQUE (ticker, window_from));
CREATE TABLE IF NOT EXISTS scans (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, ms INTEGER NOT NULL, ok INTEGER NOT NULL,
  failed INTEGER NOT NULL, llm_calls INTEGER NOT NULL, llm_usd REAL NOT NULL, note TEXT);
`);

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const sha = (s: string) => createHash("sha1").update(s).digest("hex");

function addEvent(e: { at: number; ticker: string; kind: string; title: string; sub?: string; url?: string; side?: string | null; key: string }) {
  db.prepare("INSERT OR IGNORE INTO events (at, ticker, kind, title, sub, url, side, hash) VALUES (?,?,?,?,?,?,?,?)").run(
    e.at, e.ticker, e.kind, e.title, e.sub ?? "", e.url ?? "", e.side ?? null, sha(e.key),
  );
}

/** Real token price at an NYSE open: first 15-min candle of the main pool (GeckoTerminal). */
async function priceAtOpen(r: TickerReport, openSec: number): Promise<{ price: number; source: string } | null> {
  const main = r.pools.find((p) => !p.paired);
  if (!main) return null;
  const cs = await poolCandles(main.address, r.mint, 15, openSec - 3600, openSec + 3600).catch(() => []);
  const c = cs.find((c) => c.t === openSec) ?? cs.find((c) => c.t > openSec && c.t < openSec + 1800);
  return c ? { price: c.o, source: `${r.token} ${main.dex} pool · 15-min candle open` } : null;
}

async function settle(reports: Map<Ticker, TickerReport>, nowSec: number) {
  type TradeRow = { id: number; ticker: string; side: string; entry: number; qty: number; settle_at: number };
  const due = db.prepare("SELECT id, ticker, side, entry, qty, settle_at FROM trades WHERE status='open' AND settle_at + 900 <= ?").all(nowSec) as TradeRow[];
  for (const t of due) {
    const r = reports.get(t.ticker as Ticker);
    if (!r) continue;
    const px = await priceAtOpen(r, t.settle_at);
    if (!px) continue;
    const gross = t.side === "BUY" ? (px.price - t.entry) / t.entry : (t.entry - px.price) / t.entry;
    const netPct = gross * 100 - 2 * FEE_PER_SIDE_PCT;
    db.prepare("UPDATE trades SET status='closed', closed_at=?, exit=?, exit_source=?, net_pct=?, net_usd=? WHERE id=?").run(
      nowSec, px.price, px.source, netPct, (netPct / 100) * STAKE, t.id,
    );
    addEvent({
      at: nowSec, ticker: t.ticker, kind: "TRADE", side: t.side === "BUY" ? "SELL" : "BUY",
      title: `Closed paper ${t.side === "BUY" ? "buy" : "sell"} · ${t.ticker} ${netPct >= 0 ? "+" : "−"}$${Math.abs((netPct / 100) * STAKE).toFixed(2)}`,
      sub: `entry $${t.entry.toFixed(2)} → NYSE open $${px.price.toFixed(2)} · after fees`, key: `close:${t.id}`,
    });
    log("settled trade", t.id, t.ticker, netPct.toFixed(2));
  }
  type CallRow = { id: number; ticker: string; price: number; ref_close: number; settle_at: number };
  const calls = db.prepare("SELECT id, ticker, price, ref_close, settle_at FROM calls WHERE checked_at IS NULL AND settle_at + 900 <= ?").all(nowSec) as CallRow[];
  for (const c of calls) {
    const r = reports.get(c.ticker as Ticker);
    if (!r) continue;
    const px = await priceAtOpen(r, c.settle_at);
    if (!px) continue;
    // Held = at the open the stock stayed at least half-way to where the token had moved (same direction).
    const want = c.price - c.ref_close, got = px.price - c.ref_close;
    const held = want !== 0 && Math.sign(got) === Math.sign(want) && Math.abs(got) >= Math.abs(want) / 2 ? 1 : 0;
    db.prepare("UPDATE calls SET open_price=?, held=?, checked_at=? WHERE id=?").run(px.price, held, nowSec, c.id);
    addEvent({ at: nowSec, ticker: c.ticker, kind: "CALL", side: "HOLD", title: `${c.ticker} · "Respect the gap" ${held ? "held ✓" : "did not hold ✗"}`, sub: `token $${c.price.toFixed(2)} vs close $${c.ref_close.toFixed(2)} → open $${px.price.toFixed(2)}`, key: `call:${c.id}` });
  }
}

let scanning = false;
async function scan() {
  if (scanning) return;
  scanning = true;
  const t0 = Date.now();
  const nowSec = Math.floor(t0 / 1000);
  const reports = new Map<Ticker, TickerReport>();
  let failed = 0;
  const llm0 = { n: stats.llmCalls, usd: stats.llmCostUsd };
  for (const t of TICKERS) {
    try {
      const r = await buildLive(t);
      reports.set(t, r);
      db.prepare("INSERT INTO reports (ticker, at, json) VALUES (?,?,?) ON CONFLICT(ticker) DO UPDATE SET at=excluded.at, json=excluded.json").run(t, t0, JSON.stringify(r));

      for (const h of r.headlines)
        addEvent({ at: h.time, ticker: t, kind: "NEWS", title: h.title, sub: `${h.source}${h.score ? ` · ${Math.round(h.score.caused_move * 100)}% odds it caused the move` : ""}`, url: h.url, key: `news:${t}:${h.url}` });
      for (const e of r.onchain.filter((e) => e.kind === "whale_trade" || e.kind === "volume_spike"))
        addEvent({ at: e.time, ticker: t, kind: "ON-CHAIN", title: e.title, sub: e.detail, url: e.link, key: `chain:${t}:${e.kind}:${e.time}` });

      const s = signalFor(r, liveDepth(r));
      const prev = db.prepare("SELECT signal, side FROM signals WHERE ticker=?").get(t) as { signal: string; side: string | null } | undefined;
      db.prepare("INSERT INTO signals (ticker, signal, side, why, at) VALUES (?,?,?,?,?) ON CONFLICT(ticker) DO UPDATE SET signal=excluded.signal, side=excluded.side, why=excluded.why, at=excluded.at").run(t, s.signal, s.side, s.why, nowSec);
      if (!prev || prev.signal !== s.signal || prev.side !== s.side)
        addEvent({ at: nowSec, ticker: t, kind: "SIGNAL", side: s.side ?? (s.signal === "RESPECT" ? "HOLD" : "—"), title: `${t} · ${s.signal === "FADE" ? `FADE · ${s.side}` : s.signal === "RESPECT" ? "RESPECT THE GAP" : "NO TRADE"}`, sub: s.why, key: `sig:${t}:${nowSec}` });

      const price = r.tokenPrice?.price ?? null, ref = r.reference?.price ?? null;
      const settleAt = Math.floor(nextOpen(t0) / 1000);
      if (s.signal === "FADE" && s.side && price && marketClock(t0).state !== "OPEN") {
        const open = db.prepare("SELECT id FROM trades WHERE ticker=? AND status='open'").get(t);
        if (!open) {
          const imp = r.thin?.impactPct ?? 0;
          const entry = s.side === "BUY" ? price * (1 + imp / 100) : price * (1 - imp / 100);
          const qty = STAKE / entry;
          const res = db.prepare("INSERT INTO trades (ticker, side, opened_at, entry, entry_impact, qty, ref_close, gap_pct, why, settle_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(t, s.side, nowSec, entry, imp, qty, ref, r.gapPct, s.why, settleAt);
          addEvent({ at: nowSec, ticker: t, kind: "TRADE", side: s.side, title: `Auto paper ${s.side === "BUY" ? "buy" : "sell"} ${qty.toFixed(3)} ${r.token} at $${entry.toFixed(2)}`, sub: `$1,000 paper · impact ${imp.toFixed(2)}% · settles at the next NYSE open`, key: `open:${res.lastInsertRowid}` });
          log("opened trade", t, s.side, entry.toFixed(2));
        }
      }
      if (s.signal === "RESPECT" && price && ref && r.gapPct != null && marketClock(t0).state !== "OPEN")
        db.prepare("INSERT OR IGNORE INTO calls (ticker, window_from, at, price, ref_close, gap_pct, why, settle_at) VALUES (?,?,?,?,?,?,?,?)").run(t, r.window.from, nowSec, price, ref, r.gapPct, s.why, settleAt);
    } catch (e) {
      failed++;
      log("scan failed", t, (e as Error).message);
    }
  }
  try {
    await settle(reports, nowSec);
  } catch (e) {
    log("settle failed", (e as Error).message);
  }
  const ms = Date.now() - t0;
  const llmCalls = stats.llmCalls - llm0.n, llmUsd = stats.llmCostUsd - llm0.usd;
  db.prepare("INSERT INTO scans (at, ms, ok, failed, llm_calls, llm_usd, note) VALUES (?,?,?,?,?,?,?)").run(t0, ms, reports.size, failed, llmCalls, llmUsd, null);
  log(`scan done: ${reports.size} ok, ${failed} failed, ${llmCalls} LLM calls ($${llmUsd.toFixed(4)}), ${ms} ms`);
  scanning = false;
}

// ---------- read-only API ----------
function track() {
  const trades = db.prepare("SELECT * FROM trades ORDER BY opened_at DESC LIMIT 200").all() as Record<string, number | string | null>[];
  const closed = trades.filter((t) => t.status === "closed");
  const calls = db.prepare("SELECT * FROM calls ORDER BY at DESC LIMIT 200").all() as Record<string, number | string | null>[];
  const checked = calls.filter((c) => c.checked_at != null);
  const firstScan = db.prepare("SELECT MIN(at) AS at FROM scans").get() as { at: number | null };
  const last = db.prepare("SELECT * FROM scans ORDER BY id DESC LIMIT 1").get() as Record<string, number> | undefined;
  const llm = db.prepare("SELECT COALESCE(SUM(llm_calls),0) AS n, COALESCE(SUM(llm_usd),0) AS usd, COUNT(*) AS scans FROM scans").get() as { n: number; usd: number; scans: number };
  const signals = db.prepare("SELECT * FROM signals ORDER BY ticker").all();
  return {
    since: firstScan.at,
    lastScan: last ?? null,
    scanEveryMin: SCAN_MS / 60_000,
    totals: {
      scans: llm.scans,
      llmCalls: llm.n,
      llmUsd: llm.usd,
      trades: trades.length,
      open: trades.length - closed.length,
      closed: closed.length,
      wins: closed.filter((t) => (t.net_usd as number) > 0).length,
      netUsd: closed.reduce((s, t) => s + (t.net_usd as number), 0),
      stakeUsd: STAKE,
      calls: calls.length,
      callsChecked: checked.length,
      callsHeld: checked.filter((c) => c.held === 1).length,
    },
    signals,
    trades,
    calls,
  };
}

const ok = (got: string | undefined) => {
  const want = `Bearer ${TOKEN}`;
  return !!got && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
};

createServer((req, res) => {
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/health") return send(200, { ok: true, scanning });
  if (req.method !== "GET") return send(405, { error: "read-only" });
  if (!ok(req.headers.authorization)) return send(401, { error: "unauthorized" });
  try {
    if (url.pathname === "/reports") {
      const rows = db.prepare("SELECT json FROM reports").all() as { json: string }[];
      const reports = rows.map((r) => JSON.parse(r.json) as TickerReport);
      const c = marketClock();
      return send(200, boardFrom(reports, "live", { state: c.state, lastClose: c.lastClose, nextOpen: c.nextOpen }, null));
    }
    const m = url.pathname.match(/^\/report\/([A-Z]+)$/);
    if (m && isTicker(m[1])) {
      const row = db.prepare("SELECT json FROM reports WHERE ticker=?").get(m[1]) as { json: string } | undefined;
      return row ? send(200, JSON.parse(row.json)) : send(404, { error: "not scanned yet" });
    }
    if (url.pathname === "/events") {
      const since = Number(url.searchParams.get("since") ?? 0);
      const rows = since > 0
        ? db.prepare("SELECT id, at, ticker, kind, title, sub, url, side FROM events WHERE id > ? ORDER BY id ASC LIMIT 50").all(since)
        : db.prepare("SELECT id, at, ticker, kind, title, sub, url, side FROM events ORDER BY id DESC LIMIT 40").all();
      return send(200, { events: rows });
    }
    if (url.pathname === "/track") return send(200, track());
    return send(404, { error: "not found" });
  } catch (e) {
    return send(500, { error: (e as Error).message });
  }
}).listen(PORT, () => log(`wick-wire scanner API on :${PORT}, scanning every ${SCAN_MS / 60_000} min (stocks: ${Object.keys(STOCKS).join(",")})`));

scan();
setInterval(scan, SCAN_MS);
