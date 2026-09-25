"use client";

// Wick Wire v3 — one guided page + an autonomous scanner (polls prices/reports, pops toasts, logs paper trades).
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { FEE_PER_SIDE_PCT, liveDepth, replayDepth, signalFor, type BacktestRow, type SignalResult } from "@/lib/signal";
import { TICKERS } from "@/lib/stocks";
import type { BoardPayload, ChartPayload, Mode, TickerReport } from "@/lib/types";

const K = {
  BG: "#0B0C0A", CARD: "#10110E", SUB: "#161712", SEL: "#1C1D18", LINE: "#2A2B25", LINE2: "#1F201B",
  FG: "#E4E1D4", FG2: "#C3C0B2", MID: "#A5A395", DIM: "#7C7A6D", FAINT: "#5E5D53",
  AMB: "#E8B04B", VIO: "#A493FF", UP: "#8BD17C", DN: "#F0645A", SIG: "#6FD0C8",
};
const JET = "var(--f-jet), ui-monospace, monospace";
const PRICE_POLL_MS = 20_000;
const REPORT_POLL_MS = 60_000;

const pct = (x: number | null | undefined, dp = 1) => (x == null ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(dp)}%`);
const usd = (x: number | null | undefined, dp = 2) => (x == null ? "—" : `$${x.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`);
const signedUsd = (x: number) => `${x >= 0 ? "+" : "−"}$${Math.abs(x).toFixed(2)}`;
const gapColor = (x: number | null | undefined) => (x == null ? K.DIM : x >= 0 ? K.UP : K.DN);
const et = (sec: number, o: Intl.DateTimeFormatOptions = { weekday: "short", hour: "numeric", minute: "2-digit" }) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", ...o }).format(sec * 1000);
const label = { fontSize: 13, fontWeight: 600, letterSpacing: ".06em", color: K.DIM } as const;
const card = { background: K.CARD, border: `1px solid ${K.LINE}`, padding: 24, display: "flex", flexDirection: "column", gap: 14 } as const;

type Toast = { id: number; side: string; color: string; title: string; sub: string; meta: string };
type ServerEvent = { id: number; at: number; ticker: string; kind: string; title: string; sub: string; url: string; side: string | null };
type TradeRec = { id: number; ticker: string; side: string; opened_at: number; entry: number; entry_impact: number | null; qty: number; ref_close: number | null; gap_pct: number | null; why: string; settle_at: number; closed_at: number | null; exit: number | null; exit_source: string | null; net_pct: number | null; net_usd: number | null; status: string };
type CallRec = { id: number; ticker: string; at: number; price: number; ref_close: number; gap_pct: number; why: string; settle_at: number; open_price: number | null; held: number | null };
type Track = {
  since: number | null;
  lastScan: { at: number; ms: number; ok: number; failed: number } | null;
  scanEveryMin: number;
  totals: { scans: number; llmCalls: number; llmUsd: number; trades: number; open: number; closed: number; wins: number; netUsd: number; stakeUsd: number; calls: number; callsChecked: number; callsHeld: number };
  signals: { ticker: string; signal: string; side: string | null; why: string; at: number }[];
  trades: TradeRec[];
  calls: CallRec[];
};
type Paper = { id: string; ticker: string; side: "BUY" | "SELL"; qty: number; fill: number; at: number; auto: boolean; mode: Mode };

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}

function useLocalPaper(): [Paper[], (p: Paper) => void, () => void] {
  const [list, setList] = useState<Paper[]>([]);
  useEffect(() => {
    try {
      setList(JSON.parse(localStorage.getItem("ww-paper") ?? "[]"));
    } catch {}
  }, []);
  const add = useCallback((p: Paper) => {
    setList((l) => {
      const next = [p, ...l].slice(0, 30);
      try {
        localStorage.setItem("ww-paper", JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);
  const clear = useCallback(() => {
    setList([]);
    try {
      localStorage.removeItem("ww-paper");
    } catch {}
  }, []);
  return [list, add, clear];
}

/** Signal copy in plain words (v3). */
function signalCopy(s: SignalResult, r: TickerReport) {
  if (s.signal === "RESPECT")
    return { code: "RESPECT THE GAP", title: "This move will probably stick", body: "Real news is behind it. When Wall Street opens, the stock will likely price it in too.", tone: "respect" as const };
  if (s.signal === "FADE")
    return s.side === "BUY"
      ? { code: "FADE · BUY", title: "This drop may bounce back", body: "No strong news. The drop came from on-chain trading or nothing at all, and gaps like this often close when Wall Street opens.", tone: "fade" as const }
      : { code: "FADE · SELL", title: "This rise may fade", body: "No strong news. The rise came from on-chain trading or nothing at all, and gaps like this often close when Wall Street opens.", tone: "fade" as const };
  const body = s.why.startsWith("gap under")
    ? "The move is under 1%. Too small to matter."
    : s.why.startsWith("too thin")
      ? `The pool is too thin (${s.why.replace("too thin: ", "")}). Costs would eat any gain.`
      : s.why === "mixed evidence"
        ? "News and on-chain evidence point different ways. No clear edge."
        : r.gapPct == null
          ? "Price unavailable right now, so no call."
          : "Not scored yet, so no call.";
  return { code: "NO TRADE", title: "Nothing to do", body, tone: "none" as const };
}

export default function Scanner() {
  const [mode, setModeState] = useState<Mode>("live");
  const [sel, setSel] = useState<string>("NVDA");
  const [market, setMarket] = useState<BoardPayload["market"] | null>(null);
  const [reports, setReports] = useState<Record<string, TickerReport>>({});
  const [failed, setFailed] = useState<string[]>([]);
  const [prices, setPrices] = useState<{ at: number; prices: Record<string, number> } | null>(null);
  const [chart, setChart] = useState<ChartPayload | null | "loading">("loading");
  const [bt, setBt] = useState<{ exitLabel: string; rows: BacktestRow[] } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [more, setMore] = useState(false);
  const [lastScan, setLastScan] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [paper, addPaper, clearPaper] = useLocalPaper();
  const seen = useRef<Record<string, { refs: Set<string>; signal: string }>>({});
  const [serverFeed, setServerFeed] = useState<boolean | null>(null);
  const [feed, setFeed] = useState<ServerEvent[]>([]);
  const [trackRec, setTrackRec] = useState<Track | null | "offline">(null);
  const lastEvent = useRef(0);
  const tid = useRef(0);
  const serverFeedRef = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // URL state (?mode=replay&t=NVDA)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("mode") === "replay") setModeState("replay");
    const t = q.get("t")?.toUpperCase();
    if (t && (TICKERS as readonly string[]).includes(t)) setSel(t);
  }, []);
  const syncUrl = (m: Mode, t: string) => {
    const u = new URL(window.location.href);
    if (m === "replay") u.searchParams.set("mode", "replay");
    else u.searchParams.delete("mode");
    u.searchParams.set("t", t);
    window.history.replaceState(null, "", u);
  };
  const setMode = (m: Mode) => {
    setModeState(m);
    syncUrl(m, sel);
  };
  const select = (t: string) => {
    setSel(t);
    syncUrl(mode, t);
  };

  const toast = useCallback((side: string, color: string, title: string, sub: string, meta: string, ms = 7000) => {
    const id = ++tid.current;
    setToasts((ts) => [...ts, { id, side, color, title, sub, meta }].slice(-4));
    timers.current.push(setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), ms));
  }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Backtest (replay fixture) once.
  useEffect(() => {
    getJson<{ exitLabel: string; rows: BacktestRow[] }>("/api/backtest").then(setBt).catch(() => setBt(null));
  }, []);

  const priceOf = useCallback(
    (r: TickerReport | undefined) => (r ? (mode === "live" ? (prices?.prices[r.ticker] ?? r.tokenPrice?.price ?? null) : (r.tokenPrice?.price ?? null)) : null),
    [mode, prices],
  );
  const gapOf = useCallback(
    (r: TickerReport | undefined) => {
      const p = priceOf(r), ref = r?.reference?.price ?? null;
      return p != null && ref ? ((p - ref) / ref) * 100 : (r?.gapPct ?? null);
    },
    [priceOf],
  );
  const sigOf = useCallback((r: TickerReport) => {
    const live = { ...r, gapPct: gapOf(r) };
    return signalFor(live, r.mode === "replay" ? replayDepth(r) : liveDepth(r));
  }, [gapOf]);

  // Scanner: compare a fresh report with what we've seen → toasts + auto paper trades.
  const scan = useCallback(
    (r: TickerReport, first: boolean) => {
      const refs = new Set([...r.headlines.map((h) => "N:" + h.title), ...r.onchain.map((e) => "C:" + e.title)]);
      const s = sigOf(r);
      const sigKey = `${s.signal}${s.side ?? ""}`;
      const prev = seen.current[r.ticker];
      seen.current[r.ticker] = { refs, signal: sigKey };
      if (first || !prev || r.mode !== "live" || serverFeedRef.current) return;
      for (const h of r.headlines) if (!prev.refs.has("N:" + h.title))
        toast("NEWS", K.AMB, `${r.ticker} · ${h.title}`, `${h.source} · ${et(h.time)} ET`, `scanner · odds it caused the move ${h.score ? Math.round(h.score.caused_move * 100) + "%" : "—"}`);
      for (const e of r.onchain) if (!prev.refs.has("C:" + e.title))
        toast("CHAIN", K.VIO, `${r.ticker} · ${e.title}`, e.detail, "scanner · on-chain event");
      if (prev.signal !== sigKey) {
        const c = signalCopy(s, r);
        toast(s.side ?? (s.signal === "RESPECT" ? "HOLD" : "—"), s.side === "BUY" ? K.UP : s.side === "SELL" ? K.DN : K.SIG, `${r.ticker} · ${c.code}`, c.title, `scanner · signal changed · gap ${pct(gapOf(r))}`);
      }
    },
    [gapOf, sigOf, toast],
  );

  // Load reports (+ poll in live mode).
  useEffect(() => {
    let alive = true;
    setReports({});
    setFailed([]);
    seen.current = {};
    const q = mode === "replay" ? "?mode=replay" : "";
    getJson<BoardPayload["market"]>(`/api/market${q}`).then((m) => alive && setMarket(m)).catch(() => {});
    const loadAll = (first: boolean) =>
      TICKERS.forEach((t) =>
        getJson<TickerReport>(`/api/stock/${t}${q}`)
          .then((r) => {
            if (!alive) return;
            setReports((rs) => ({ ...rs, [t]: r }));
            setFailed((f) => f.filter((x) => x !== t));
            setLastScan(Date.now());
            scan(r, first);
          })
          .catch(() => alive && first && setFailed((f) => (f.includes(t) ? f : [...f, t]))),
      );
    loadAll(true);
    if (mode !== "live") return () => void (alive = false);
    const iv = setInterval(() => loadAll(false), REPORT_POLL_MS);
    const mv = setInterval(() => getJson<BoardPayload["market"]>("/api/market").then((m) => alive && setMarket(m)).catch(() => {}), 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(iv);
      clearInterval(mv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Shared scanner feed (our server): toasts for everything new, for every visitor.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const j = await getJson<{ events: ServerEvent[] }>(`/api/events${lastEvent.current ? `?since=${lastEvent.current}` : ""}`);
        if (!alive) return;
        serverFeedRef.current = true;
        setServerFeed(true);
        const first = lastEvent.current === 0;
        const evs = [...j.events].sort((a, b) => a.id - b.id);
        if (evs.length) lastEvent.current = evs.at(-1)!.id;
        setFeed((f) => [...evs.reverse(), ...f].slice(0, 40));
        if (!first)
          for (const e of evs.slice(-4)) {
            const col = e.kind === "NEWS" ? K.AMB : e.kind === "ON-CHAIN" ? K.VIO : e.side === "BUY" ? K.UP : e.side === "SELL" ? K.DN : K.SIG;
            const badge = e.kind === "NEWS" ? "NEWS" : e.kind === "ON-CHAIN" ? "CHAIN" : (e.side ?? e.kind).slice(0, 5);
            toast(badge, col, e.kind === "NEWS" || e.kind === "ON-CHAIN" ? `${e.ticker} · ${e.title}` : e.title, e.sub, `scanner · ${e.kind.toLowerCase()} · ${et(e.at)} ET`);
          }
      } catch {
        if (!alive) return;
        serverFeedRef.current = false;
        setServerFeed(false);
      }
    };
    const pollTrack = () => getJson<Track>("/api/track").then((t) => alive && setTrackRec(t)).catch(() => alive && setTrackRec("offline"));
    poll();
    pollTrack();
    const a = setInterval(poll, 30_000), b = setInterval(pollTrack, 60_000);
    return () => {
      alive = false;
      clearInterval(a);
      clearInterval(b);
    };
  }, [toast]);

  // Live prices poll.
  useEffect(() => {
    if (mode !== "live") return;
    let alive = true;
    const tick = () => getJson<{ at: number; prices: Record<string, number> }>("/api/prices").then((p) => alive && setPrices(p)).catch(() => {});
    tick();
    const iv = setInterval(tick, PRICE_POLL_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [mode]);

  // Chart for the selected stock.
  useEffect(() => {
    let alive = true;
    setChart("loading");
    getJson<ChartPayload>(`/api/chart/${sel}?res=60${mode === "replay" ? "&mode=replay" : ""}`)
      .then((c) => alive && setChart(c))
      .catch(() => alive && setChart(null));
    return () => void (alive = false);
  }, [sel, mode]);

  const list = TICKERS.map((t) => reports[t]).filter(Boolean) as TickerReport[];
  const tiles = [...list].sort((a, b) => Math.abs(gapOf(b) ?? 0) - Math.abs(gapOf(a) ?? 0));
  const r = reports[sel];
  const open = market?.state === "OPEN";
  const clockNow = mode === "replay" && r ? r.window.to * 1000 : now;
  const left = market?.nextOpen ? Math.max(0, market.nextOpen - clockNow) : null;
  const opensAt = market?.nextOpen ? et(market.nextOpen / 1000, { weekday: "long", hour: "numeric", minute: "2-digit" }) : "";
  const marketLine = !market
    ? "Checking the market clock…"
    : open
      ? "Wall Street is open. Tokens track the real stock."
      : `Wall Street is closed · reopens ${opensAt} ET${left != null ? ` (in ${Math.floor(left / 3_600_000)}h ${Math.floor((left % 3_600_000) / 60_000)}m)` : ""}`;

  return (
    <div style={{ minHeight: "100vh", background: K.BG, color: K.FG, fontFamily: "var(--f-sans), system-ui, sans-serif", fontSize: 16, lineHeight: 1.5 }}>
      <header style={{ borderBottom: `1px solid ${K.LINE}` }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "14px 24px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ fontFamily: JET, fontWeight: 800, fontSize: 18, letterSpacing: ".04em", background: K.AMB, color: K.BG, padding: "3px 10px" }}>WICK WIRE</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: "auto", fontSize: 14 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: open ? K.UP : K.AMB }} />
            <span>{marketLine}</span>
          </div>
          <ScannerStatus mode={mode} lastScan={trackRec && trackRec !== "offline" && trackRec.lastScan ? trackRec.lastScan.at : lastScan} prices={prices} now={now} server={serverFeed} />
          <div style={{ display: "flex", border: `1px solid ${K.LINE}`, fontFamily: JET, fontSize: 12 }}>
            <button onClick={() => setMode("live")} style={{ font: "inherit", padding: "7px 14px", border: 0, cursor: "pointer", background: mode === "live" ? K.FG : "transparent", color: mode === "live" ? K.BG : K.DIM }}>LIVE</button>
            <button onClick={() => setMode("replay")} style={{ font: "inherit", padding: "7px 14px", border: 0, cursor: "pointer", background: mode === "replay" ? K.AMB : "transparent", color: mode === "replay" ? K.BG : K.DIM }}>REPLAY 19–20 SEP</button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 24px 64px", display: "flex", flexDirection: "column", gap: 48 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 760 }}>
          <h1 style={{ margin: 0, fontSize: 36, lineHeight: 1.15, fontWeight: 700, letterSpacing: "-.01em", textWrap: "pretty" }}>
            {mode === "replay" ? "A real weekend, replayed: Fri 18 → Sun 20 Sep 2026." : open ? "Wall Street is open. Here's how far each token drifted." : "Wall Street is closed. Your stock token kept trading."}
          </h1>
          <p style={{ margin: 0, fontSize: 18, color: K.MID, textWrap: "pretty" }}>
            Pick a stock to see how far it moved since the last close, <span style={{ color: K.FG }}>why</span>, and whether the move is likely to stick.
            {mode === "live" && " The scanner keeps watching: new headlines, on-chain events and signals pop up without a refresh."}
          </p>
        </div>

        {/* 01 · tiles */}
        <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <SectionHead n="01" title="Pick a stock" note="change since the last NYSE close" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(132px,1fr))", gap: 10 }}>
            {tiles.map((t) => {
              const g = gapOf(t), on = t.ticker === sel;
              const drv = t.flag === "NEWS" ? ["News", K.AMB] : t.flag === "ON-CHAIN" ? ["On-chain", K.VIO] : t.flag === "NEWS + ON-CHAIN" ? ["News + on-chain", K.FG] : t.flag === "UNEXPLAINED" ? ["Unclear", K.DIM] : ["Not scored", K.FAINT];
              return (
                <button key={t.ticker} onClick={() => select(t.ticker)} style={{ font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer", padding: "14px 14px 12px", display: "flex", flexDirection: "column", gap: 6, background: on ? K.SEL : K.CARD, border: `1px solid ${on ? K.FG : K.LINE}` }}>
                  <span style={{ fontFamily: JET, fontWeight: 600, fontSize: 15 }}>{t.ticker}</span>
                  <span style={{ fontFamily: JET, fontWeight: 800, fontSize: 26, lineHeight: 1, color: gapColor(g) }}>{pct(g)}</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: drv[1] }}>{drv[0]}</span>
                </button>
              );
            })}
            {TICKERS.filter((t) => !reports[t]).map((t) => (
              <div key={t} className={failed.includes(t) ? undefined : "skeleton"} style={{ padding: "14px 14px 12px", border: `1px solid ${K.LINE}`, minHeight: 96, display: "flex", flexDirection: "column", gap: 6, fontFamily: JET }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{t}</span>
                <span style={{ fontSize: 12, color: K.DIM }}>{failed.includes(t) ? "unavailable" : "reading…"}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13, color: K.DIM }}>
            <span><span style={{ color: K.AMB }}>■</span> moved by news</span>
            <span><span style={{ color: K.VIO }}>■</span> moved by on-chain trading</span>
            <span><span style={{ color: K.FG }}>■</span> both</span>
          </div>
        </section>

        {/* 02 · detail */}
        <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <SectionHead n="02" title={`${sel}: what happened`} note={r ? `${r.name} · token ${r.token} on Solana` : ""} />
          {!r ? (
            <div className="skeleton" style={{ height: 380, border: `1px solid ${K.LINE}` }} />
          ) : (
            <Detail r={r} price={priceOf(r)} gap={gapOf(r)} sig={sigOf(r)} chart={chart} mode={mode}
              onPaper={(side, qty, fill) => {
                addPaper({ id: `${r.ticker}-${Date.now()}`, ticker: r.ticker, side, qty, fill, at: Date.now(), auto: false, mode });
                toast(side, side === "BUY" ? K.UP : K.DN, `${side === "BUY" ? "Bought" : "Sold"} ${qty.toFixed(3)} ${r.token}`, `at ${usd(fill)} · ${side === "BUY" ? "paid $1,000.00 USDC" : `received ${usd(qty * fill * (1 - FEE_PER_SIDE_PCT / 100))} USDC`}`, `paper trade · impact ${r.thin ? r.thin.impactPct.toFixed(2) + "%" : "n/a"} · exit plan: next NYSE open`);
              }}
            />
          )}
          {r && (
            <>
              <button onClick={() => setMore((m) => !m)} style={{ alignSelf: "flex-start", font: "inherit", fontSize: 14, color: K.MID, background: "transparent", border: `1px solid ${K.LINE}`, padding: "8px 14px", cursor: "pointer" }}>
                {more ? "Hide details" : "Show full story and trading pools"}
              </button>
              {more && <More r={r} price={priceOf(r)} mode={mode} />}
            </>
          )}
        </section>

        {/* 03 · replay backtest */}
        <Backtest bt={bt} onSelect={select} toast={toast} />

        {/* 04 · scanner track record (server) */}
        <TrackRecord track={trackRec} feed={feed} prices={prices?.prices ?? {}} onSelect={select} />

        {/* 05 · your manual paper trades */}
        <PaperLog paper={paper} reports={reports} prices={prices?.prices ?? {}} onClear={clearPaper} />

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,260px),1fr))", gap: 24, paddingTop: 24, borderTop: `1px solid ${K.LINE}` }}>
          {[
            ["1 · Compare", "The token's live price against the stock's real last close (Pyth where our key is entitled, labelled fallbacks elsewhere)."],
            ["2 · Read", "Every headline and every on-chain event since the close: big trades, volume spikes, pools, paired memecoins."],
            ["3 · Score", "AI (Claude Haiku) rates how much of the move each one explains, then writes the answer. The scanner re-checks every few minutes."],
          ].map(([a, b]) => (
            <div key={a} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontFamily: JET, fontSize: 13, color: K.AMB }}>{a}</span>
              <span style={{ fontSize: 14, color: K.MID }}>{b}</span>
            </div>
          ))}
        </section>

        <div style={{ fontSize: 12, color: K.FAINT, display: "flex", flexWrap: "wrap", gap: "6px 20px" }}>
          <span>Not financial advice. Tokenized stocks are not available to US persons and are restricted in some regions.</span>
          <span>Prices: Pyth (entitled feeds), Jupiter · Pools: DexScreener, GeckoTerminal · News: Finnhub, Google News · Scoring: Claude Haiku{mode === "replay" ? " · Replay data" : ""}</span>
          <Link href={`/desk${mode === "replay" ? "?mode=replay" : ""}`} style={{ color: K.DIM }}>Pro desk view →</Link>
        </div>
      </main>

      <div style={{ position: "fixed", right: 20, bottom: 20, display: "flex", flexDirection: "column", gap: 10, zIndex: 50, width: "min(380px,calc(100vw - 40px))", pointerEvents: "none" }} aria-live="polite">
        {toasts.map((n) => (
          <div key={n.id} style={{ pointerEvents: "auto", display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto", gap: 12, alignItems: "start", padding: "14px 16px", background: K.SUB, border: `1px solid ${n.color}`, boxShadow: "0 12px 32px rgba(0,0,0,.5)" }}>
            <span style={{ fontFamily: JET, fontSize: 13, fontWeight: 800, padding: "3px 8px", background: n.color, color: K.BG }}>{n.side}</span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <b style={{ fontWeight: 600, fontSize: 15 }}>{n.title}</b>
              <span style={{ fontSize: 13, color: K.MID }}>{n.sub}</span>
              <span style={{ fontSize: 11, color: K.FAINT, fontFamily: JET }}>{n.meta}</span>
            </span>
            <button onClick={() => setToasts((ts) => ts.filter((x) => x.id !== n.id))} aria-label="Dismiss" style={{ font: "inherit", background: "transparent", border: 0, color: K.DIM, cursor: "pointer", padding: "0 2px", fontSize: 16, lineHeight: 1 }}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionHead({ n, title, note, right }: { n: string; title: string; note?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
      <span style={{ fontFamily: JET, fontSize: 13, color: K.AMB }}>{n}</span>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{title}</h2>
      {note && <span style={{ fontSize: 14, color: K.DIM, marginRight: right ? "auto" : undefined }}>{note}</span>}
      {right}
    </div>
  );
}

function ScannerStatus({ mode, lastScan, prices, now, server }: { mode: Mode; lastScan: number | null; prices: { at: number } | null; now: number; server: boolean | null }) {
  if (mode !== "live") return <span style={{ fontFamily: JET, fontSize: 12, color: K.DIM }}>SCANNER PAUSED · REPLAY</span>;
  if (server === false) return <span style={{ fontFamily: JET, fontSize: 12, color: K.DN }}>SERVER SCANNER OFFLINE · browser mode</span>;
  const ago = (t: number | null) => (t == null ? "—" : `${Math.max(0, Math.round((now - t) / 1000))}s`);
  return (
    <span style={{ fontFamily: JET, fontSize: 12, color: K.DIM, display: "flex", alignItems: "center", gap: 6 }} title="Prices every 20 s · reports every 60 s (server re-gathers every 10 min)">
      <span className="pulse" style={{ width: 7, height: 7, borderRadius: "50%", background: K.SIG, display: "inline-block" }} />
      SCANNER 24/7 · price {ago(prices?.at ?? null)} · last scan {ago(lastScan)}
    </span>
  );
}

function Detail(props: { r: TickerReport; price: number | null; gap: number | null; sig: SignalResult; chart: ChartPayload | null | "loading"; mode: Mode; onPaper: (side: "BUY" | "SELL", qty: number, fill: number) => void }) {
  const { r, price, gap, sig, chart, mode } = props;
  const d = r.driver;
  const events = [
    ...r.headlines.map((h) => ({ key: h.ref, kind: "News" as const, title: h.title, src: h.source, time: h.time, p: h.score?.caused_move ?? null, url: h.url })),
    ...r.onchain.map((e) => ({ key: e.id, kind: "On-chain" as const, title: e.title, src: e.detail.split(" · ")[0], time: e.time, p: e.score?.caused_move ?? null, url: e.link })),
  ]
    .sort((a, b) => (b.p ?? -1) - (a.p ?? -1))
    .slice(0, 3);
  let ni = 0, ci = 0;
  const reasons = events.map((e) => ({ ...e, id: e.kind === "News" ? String(++ni) : String.fromCharCode(64 + ++ci) }));
  const c = signalCopy(sig, r);
  const imp = r.thin?.impactPct ?? null;
  const fade = c.tone === "fade";
  const buy = sig.side === "BUY";
  const fill = price ? (buy ? price * (1 + (imp ?? 0) / 100) : price * (1 - (imp ?? 0) / 100)) : null;
  const qty = fill && price ? (buy ? (1000 * (1 - FEE_PER_SIDE_PCT / 100)) / fill : 1000 / price) : null;
  const ref = r.reference?.price ?? null;
  const closeWord = r.reference ? (r.reference.label.includes("NOW") ? "NYSE now" : `${et(r.reference.time, { weekday: "long" })} close`) : "Last close";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))", gap: 12 }}>
      {/* HOW MUCH */}
      <div style={card}>
        <div style={label}>HOW MUCH IT MOVED</div>
        <div style={{ fontFamily: JET, fontWeight: 800, fontSize: 56, lineHeight: 0.9, color: gapColor(gap) }}>{pct(gap)}</div>
        <div style={{ fontSize: 15, color: K.MID }}>
          {closeWord} <b style={{ color: K.FG }}>{usd(ref)}</b> → {mode === "replay" ? "Sun 8 PM" : "now"} <b style={{ color: K.FG }}>{usd(price)}</b>
        </div>
        <LineChart chart={chart} r={r} gap={gap} reasons={reasons} />
        <div style={{ fontSize: 11, color: K.FAINT, fontFamily: JET }}>
          {[r.reference?.label, mode === "live" ? `${r.token} NOW · JUPITER (live)` : r.tokenPrice?.label].filter(Boolean).join(" · ")}
        </div>
      </div>

      {/* WHY */}
      <div style={card}>
        <div style={label}>WHY IT MOVED</div>
        <div style={{ fontSize: 22, lineHeight: 1.35, fontWeight: 600, textWrap: "pretty" }}>{r.reason ?? <span style={{ color: K.DIM }}>Explanation unavailable right now.</span>}</div>
        {d && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", height: 10, background: K.LINE }}>
              <div style={{ width: `${d.news * 100}%`, background: K.AMB }} />
              <div style={{ width: `${d.onchain * 100}%`, background: K.VIO }} />
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
              <span style={{ color: K.AMB }}>News {Math.round(d.news * 100)}%</span>
              <span style={{ color: K.VIO }}>On-chain {Math.round(d.onchain * 100)}%</span>
              <span style={{ color: K.DIM }}>Unclear {Math.round(d.unexplained * 100)}%</span>
            </div>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
          {reasons.length === 0 && <span style={{ fontSize: 14, color: K.DIM }}>No headlines or on-chain events in this window.</span>}
          {reasons.map((e) => {
            const col = e.kind === "News" ? K.AMB : K.VIO;
            return (
              <a key={e.key} href={e.url} target="_blank" rel="noreferrer" style={{ display: "grid", gridTemplateColumns: "22px minmax(0,1fr) auto", gap: 10, alignItems: "start", padding: "10px 12px", background: K.SUB, color: K.FG, textDecoration: "none" }}>
                <span style={{ width: 20, height: 20, display: "grid", placeItems: "center", fontFamily: JET, fontSize: 11, fontWeight: 800, color: K.BG, background: col, borderRadius: e.kind === "News" ? "50%" : 2, marginTop: 2 }}>{e.id}</span>
                <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 15, lineHeight: 1.35 }}>{e.title}</span>
                  <span style={{ fontSize: 12, color: K.DIM }}>{e.kind} · {e.src} · {et(e.time)} ET</span>
                </span>
                <span style={{ fontFamily: JET, fontSize: 13, fontWeight: 600, color: col }}>{e.p == null ? "—" : `${Math.round(e.p * 100)}%`}</span>
              </a>
            );
          })}
        </div>
      </div>

      {/* WILL IT STICK */}
      <div style={card}>
        <div style={label}>WILL IT STICK?</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 16, border: `1px solid ${fade ? K.SIG : c.tone === "respect" ? "#2F5956" : K.LINE}`, background: fade ? "#0F1F1D" : K.CARD }}>
          <span style={{ fontFamily: JET, fontSize: 12, fontWeight: 800, letterSpacing: ".06em", color: c.tone === "none" ? K.DIM : K.SIG }}>{c.code}</span>
          <span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>{c.title}</span>
          <span style={{ fontSize: 15, color: K.FG2, lineHeight: 1.45, textWrap: "pretty" }}>{c.body}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
          <span style={{ color: K.DIM }}>Cost to trade $1,000 right now (Jupiter)</span>
          {imp != null ? (
            <span>
              <b style={{ fontFamily: JET, color: imp > 1 ? K.DN : K.FG }}>{imp.toFixed(2)}%</b> price impact{" "}
              <span style={{ color: K.DIM }}>· {imp > 1 ? "too thin to trade" : imp > 0.5 ? "okay" : "cheap"} · via {r.thin!.route}</span>
            </span>
          ) : (
            <span style={{ color: K.DIM }}>{mode === "replay" ? "Not recorded for replay (quotes are live-only)." : "Quote unavailable right now."}</span>
          )}
        </div>
        {fade && price && fill && qty && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={label}>THE PAPER TRADE</span>
            <Leg side={buy ? "BUY" : "SELL"} text={`${buy ? "Buy" : "Sell"} ${qty.toFixed(3)} ${r.token} at ~${usd(fill)}`} when={buy ? "now · pay $1,000 USDC" : `now · you receive ~${usd(qty * fill * (1 - FEE_PER_SIDE_PCT / 100))} USDC`} />
            <Leg side={buy ? "SELL" : "BUY"} text={buy ? "Sell at the next NYSE open" : "Buy it back at the next NYSE open"} when={`profit if the price moves back toward ${usd(ref)}`} />
            <button onClick={() => props.onPaper(buy ? "BUY" : "SELL", qty, fill)} style={{ font: "inherit", fontWeight: 700, fontSize: 15, padding: "12px 16px", border: 0, cursor: "pointer", textAlign: "left", background: buy ? K.UP : K.DN, color: K.BG }}>
              Paper {buy ? "buy" : "sell"} {qty.toFixed(3)} {r.token} →
            </button>
          </div>
        )}
        <div style={{ fontSize: 12, color: K.FAINT, marginTop: "auto" }}>Paper trades only. Wick Wire never places real trades. Not financial advice.</div>
      </div>
    </div>
  );
}

function Leg({ side, text, when }: { side: "BUY" | "SELL"; text: string; when: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "56px minmax(0,1fr)", gap: 10, alignItems: "center", padding: "10px 12px", background: K.SUB }}>
      <span style={{ fontFamily: JET, fontSize: 13, fontWeight: 800, textAlign: "center", padding: "3px 0", background: side === "BUY" ? K.UP : K.DN, color: K.BG }}>{side}</span>
      <span style={{ display: "flex", flexDirection: "column" }}>
        <b style={{ fontWeight: 600 }}>{text}</b>
        <span style={{ fontSize: 12, color: K.DIM }}>{when}</span>
      </span>
    </div>
  );
}

function LineChart({ chart, r, gap, reasons }: { chart: ChartPayload | null | "loading"; r: TickerReport; gap: number | null; reasons: { id: string; kind: string; time: number }[] }) {
  if (chart === "loading") return <div className="skeleton" style={{ height: 170 }} />;
  const cs = chart?.candles.filter((c) => c.t >= r.window.from - 3600) ?? [];
  if (cs.length < 2) return <div style={{ height: 170, display: "grid", placeItems: "center", fontSize: 13, color: K.DIM }}>Chart unavailable for this window.</div>;
  const W = 600, H = 170, P = 18;
  const ref = r.reference?.price ?? cs[0].o;
  const vals = cs.map((c) => c.c).concat(ref);
  const hi = Math.max(...vals), lo = Math.min(...vals);
  const t0 = r.window.from, t1 = Math.max(r.window.to, cs.at(-1)!.t);
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * W;
  const y = (v: number) => P + ((hi - v) / (hi - lo || 1)) * (H - 2 * P);
  const pts = cs.map((c) => `${x(c.t).toFixed(1)} ${y(c.c).toFixed(1)}`);
  const cy = y(ref);
  const col = gapColor(gap);
  const near = (t: number) => cs.reduce((b, c) => (Math.abs(c.t - t) < Math.abs(b.t - t) ? c : b), cs[0]);
  const days: { t: number; l: string }[] = [];
  const hr = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" });
  for (let t = Math.ceil(t0 / 3600) * 3600; t < t1; t += 3600) if (Number(hr.format(t * 1000)) === 0) days.push({ t, l: et(t, { weekday: "short" }) });
  return (
    <>
      <div style={{ position: "relative", height: 170, marginTop: 6 }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: 170, overflow: "visible" }} aria-label={`${r.token} price over the window`}>
          <path d={`M0 ${cy.toFixed(1)} L${pts.join(" L")} L${x(cs.at(-1)!.t).toFixed(1)} ${cy.toFixed(1)} Z`} fill={col} opacity=".12" />
          <line x1="0" x2={W} y1={cy} y2={cy} stroke={K.AMB} strokeWidth="1.5" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
          <path d={`M${pts.join(" L")}`} fill="none" stroke={col} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        <div style={{ position: "absolute", right: 0, top: cy + 4, fontSize: 11, color: K.AMB, fontFamily: JET, background: K.CARD, padding: "0 4px" }}>close</div>
        {reasons.map((m) => {
          if (m.time < t0 || m.time > t1) return null;
          const c = near(m.time), isN = m.kind === "News";
          return (
            <div key={m.id} style={{ position: "absolute", left: `${((x(m.time) / W) * 100).toFixed(1)}%`, top: Math.max(0, y(c.c) - 16), transform: "translate(-50%,-50%)", width: 20, height: 20, display: "grid", placeItems: "center", fontFamily: JET, fontSize: 11, fontWeight: 800, color: K.BG, background: isN ? K.AMB : K.VIO, borderRadius: isN ? "50%" : 2 }}>
              {m.id}
            </div>
          );
        })}
      </div>
      <div style={{ position: "relative", height: 16, fontFamily: JET, fontSize: 11, color: K.FAINT }}>
        <span style={{ position: "absolute", left: 0 }}>{et(t0, { weekday: "short", hour: "numeric" })}</span>
        {days.filter((d) => x(d.t) > 70 && x(d.t) < W - 60).map((d) => (
          <span key={d.t} style={{ position: "absolute", left: `${((x(d.t) / W) * 100).toFixed(1)}%` }}>{d.l}</span>
        ))}
        <span style={{ position: "absolute", right: 0 }}>{r.mode === "replay" ? "Sun 8 PM" : "now"}</span>
      </div>
    </>
  );
}

function More({ r, price, mode }: { r: TickerReport; price: number | null; mode: Mode }) {
  const story = r.explanation.map((s) => s.text).join("").replace(/\s+/g, " ").trim();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", gap: 24, padding: "20px 0", borderTop: `1px solid ${K.LINE}` }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={label}>THE FULL STORY</div>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: K.FG2, textWrap: "pretty" }}>{story || "Not available."}</p>
        <div style={{ fontSize: 12, color: K.FAINT }}>
          Window: {r.window.label}.{r.scorer ? ` Scored by ${r.scorer.name} in ${r.scorer.latencyMs} ms for $${r.scorer.costUsd.toFixed(4)}.` : ""}
          {r.unavailable.length ? ` Unavailable: ${r.unavailable.join("; ")}.` : ""}
        </div>
        <Link href={`/stock/${r.ticker}${mode === "replay" ? "?mode=replay" : ""}`} style={{ fontSize: 14, color: K.AMB }}>Open the full desk for {r.ticker} (candles, every event) →</Link>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={label}>WHERE {r.token} TRADES</div>
        {r.pools.slice(0, 8).map((p) => {
          const dev = p.impliedPrice && price ? ((p.impliedPrice - price) / price) * 100 : null;
          const note = p.paired ? "paired token (memecoin etc.)" : dev != null && Math.abs(dev) > 1 ? `priced ${pct(dev)} vs market` : "normal";
          return (
            <a key={p.address} href={p.url} target="_blank" rel="noreferrer" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 14, padding: "8px 0", borderBottom: `1px solid ${K.LINE2}`, fontSize: 14, color: K.FG, textDecoration: "none" }}>
              <span>
                <b style={{ fontFamily: JET, fontWeight: 600, color: p.paired ? K.VIO : K.FG }}>{p.pair}</b> <span style={{ color: K.DIM }}>on {p.dex}</span>
              </span>
              <span style={{ fontFamily: JET, color: gapColor(p.change24hPct ?? p.otherChange24hPct) }}>{pct(p.change24hPct ?? p.otherChange24hPct)} <span style={{ color: K.FAINT, fontSize: 11 }}>24h</span></span>
              <span style={{ color: p.paired || note !== "normal" ? K.VIO : K.DIM, fontSize: 13 }}>{note}</span>
            </a>
          );
        })}
        {r.pools.length === 0 && <span style={{ color: K.DIM, fontSize: 14 }}>Pool list unavailable.</span>}
      </div>
    </div>
  );
}

function Backtest({ bt, onSelect, toast }: { bt: { exitLabel: string; rows: BacktestRow[] } | null; onSelect: (t: string) => void; toast: (side: string, color: string, title: string, sub: string, meta: string, ms?: number) => void }) {
  if (!bt) return null;
  const rows = bt.rows;
  const traded = rows.filter((r) => r.netPct != null);
  const wins = traded.filter((r) => (r.netPct ?? 0) > 0).length;
  const net = traded.reduce((s, r) => s + ((r.netPct ?? 0) / 100) * 1000, 0);
  const respects = rows.filter((r) => r.signal === "RESPECT");
  const held = respects.filter((r) => (r.gapClosedPct ?? 0) < 50).length;
  const blind = rows.filter((r) => r.fadeAnywayNetPct != null);
  const blindNet = blind.reduce((s, r) => s + ((r.fadeAnywayNetPct ?? 0) / 100) * 1000, 0);
  const blindLost = blind.filter((r) => (r.fadeAnywayNetPct ?? 0) < 0).length;
  const result = (r: BacktestRow) =>
    r.netPct != null
      ? { t: signedUsd((r.netPct / 100) * 1000), c: r.netPct >= 0 ? K.UP : K.DN }
      : r.signal === "RESPECT"
        ? (r.gapClosedPct ?? 0) < 50
          ? { t: "held ✓", c: K.FG }
          : { t: "closed ✗", c: K.DN }
        : { t: "skipped", c: K.DIM };
  const replay = () =>
    rows.forEach((r, i) =>
      setTimeout(() => {
        const res = result(r);
        toast(
          r.side ?? (r.signal === "RESPECT" ? "HOLD" : "SKIP"),
          r.side === "BUY" ? K.UP : r.side === "SELL" ? K.DN : r.signal === "RESPECT" ? K.SIG : K.DIM,
          `${r.ticker} · ${r.signal === "RESPECT" ? "Respect the gap" : r.signal === "FADE" ? `Fade · ${r.side?.toLowerCase()}` : "No trade"} · ${res.t}`,
          `Sun 8 PM ${usd(r.entry)} → Mon open ${usd(r.exit)}`,
          `replay · ${r.why}`,
          6000,
        );
      }, i * 1100),
    );
  const stat = (k: string, v: string, c: string, s: string) => (
    <div style={{ background: K.CARD, border: `1px solid ${K.LINE}`, padding: 20, display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 13, color: K.DIM }}>{k}</span>
      <span style={{ fontFamily: JET, fontSize: 32, fontWeight: 800, lineHeight: 1.1, color: c }}>{v}</span>
      <span style={{ fontSize: 14, color: K.MID }}>{s}</span>
    </div>
  );
  const cols = "64px minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) 90px";
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionHead
        n="03"
        title="Did the signals work last weekend?"
        note="Replay example (1 weekend, 8 stocks) · $1,000 per trade"
        right={
          <button onClick={replay} style={{ font: "inherit", fontSize: 14, fontWeight: 600, padding: "8px 14px", border: `1px solid ${K.SIG}`, background: "transparent", color: K.SIG, cursor: "pointer" }}>
            ▶ Replay the trades
          </button>
        }
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,200px),1fr))", gap: 12 }}>
        {stat("Paper trades", String(traded.length), K.FG, traded.length ? `${wins} won · ${traded.length - wins} lost` : "no FADE setups: every gap was under 1% or explained by news")}
        {stat("Net result after fees", traded.length ? signedUsd(net) : "$0.00", traded.length ? (net >= 0 ? K.UP : K.DN) : K.FG, traded.length ? `on $${(traded.length * 1000).toLocaleString()} traded` : "stayed out")}
        {stat('"Respect the gap" calls', `${held} / ${respects.length}`, K.SIG, "gaps held at Monday's open")}
        {stat("If you'd faded every gap", signedUsd(blindNet), blindNet >= 0 ? K.UP : K.DN, `lost on ${blindLost} of ${blind.length} stocks after fees`)}
      </div>
      <div style={{ border: `1px solid ${K.LINE}`, overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 16, padding: "10px 18px", fontSize: 12, fontWeight: 600, letterSpacing: ".06em", color: K.DIM, borderBottom: `1px solid ${K.LINE}`, minWidth: 620 }}>
          <span>STOCK</span><span>SIGNAL</span><span>SUN 8 PM · OPEN</span><span>MON 9:30 AM · CLOSE</span><span style={{ textAlign: "right" }}>RESULT</span>
        </div>
        {rows.map((r) => {
          const res = result(r), skip = res.t === "skipped";
          const sideBg = (s: string) => (s === "BUY" ? K.UP : K.DN);
          const back = r.side === "BUY" ? "SELL" : "BUY";
          return (
            <div key={r.ticker} onClick={() => onSelect(r.ticker)} style={{ display: "grid", gridTemplateColumns: cols, gap: 16, alignItems: "center", padding: "12px 18px", borderBottom: `1px solid ${K.LINE2}`, fontSize: 14, cursor: "pointer", opacity: skip ? 0.6 : 1, minWidth: 620 }}>
              <span style={{ fontFamily: JET, fontWeight: 600 }}>{r.ticker}</span>
              <span style={{ color: skip ? K.DIM : K.SIG, fontWeight: 600 }}>
                {r.signal === "RESPECT" ? "Respect the gap" : r.signal === "FADE" ? `Fade · ${r.side?.toLowerCase()}` : "No trade"}
                <span style={{ display: "block", fontSize: 12, fontWeight: 400, color: K.DIM }}>{r.why}</span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {r.side && <span style={{ fontFamily: JET, fontSize: 11, fontWeight: 800, padding: "2px 6px", background: sideBg(r.side), color: K.BG }}>{r.side}</span>}
                <span style={{ fontFamily: JET, color: K.FG2 }}>{r.side ? usd(r.entry) : `no trade · ${usd(r.entry)}`}</span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {r.side && <span style={{ fontFamily: JET, fontSize: 11, fontWeight: 800, padding: "2px 6px", background: sideBg(back), color: K.BG }}>{back}</span>}
                <span style={{ fontFamily: JET, color: K.FG2 }}>opened {usd(r.exit)}</span>
              </span>
              <span style={{ textAlign: "right", fontFamily: JET, fontWeight: 600, color: res.c }}>{res.t}</span>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 13, color: K.DIM, maxWidth: 760 }}>
        One weekend is not proof. We show every skipped trade and every loss on purpose. Prices: token in its main DEX pool at Sun 8 PM ET and at {bt.exitLabel}; fees {FEE_PER_SIDE_PCT}% per side assumed. Paper only, real historical data, not financial advice.
      </div>
    </section>
  );
}

function PaperLog({ paper, reports, prices, onClear }: { paper: Paper[]; reports: Record<string, TickerReport>; prices: Record<string, number>; onClear: () => void }) {
  if (!paper.length) return null;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionHead
        n="05"
        title="Your paper trades"
        note="the ones you clicked · stored in this browser only · marked to the live price"
        right={<button onClick={onClear} style={{ font: "inherit", fontSize: 13, color: K.DIM, background: "transparent", border: `1px solid ${K.LINE}`, padding: "6px 12px", cursor: "pointer" }}>Clear</button>}
      />
      <div style={{ border: `1px solid ${K.LINE}` }}>
        {paper.map((p) => {
          const nowP = prices[p.ticker] ?? reports[p.ticker]?.tokenPrice?.price ?? null;
          const pnl = nowP ? (p.side === "BUY" ? (nowP - p.fill) * p.qty : (p.fill - nowP) * p.qty) - 1000 * (FEE_PER_SIDE_PCT / 100) : null;
          return (
            <div key={p.id} style={{ display: "grid", gridTemplateColumns: "56px 64px minmax(0,1fr) 110px", gap: 14, alignItems: "center", padding: "10px 18px", borderBottom: `1px solid ${K.LINE2}`, fontSize: 14 }}>
              <span style={{ fontFamily: JET, fontSize: 12, fontWeight: 800, textAlign: "center", padding: "2px 0", background: p.side === "BUY" ? K.UP : K.DN, color: K.BG }}>{p.side}</span>
              <span style={{ fontFamily: JET, fontWeight: 600 }}>{p.ticker}</span>
              <span style={{ color: K.FG2 }}>
                {p.qty.toFixed(3)} {p.ticker}x at {usd(p.fill)} <span style={{ color: K.DIM, fontSize: 12 }}>· {new Date(p.at).toLocaleString()} · {p.auto ? "auto (scanner)" : "manual"}{p.mode === "replay" ? " · replay price" : ""}</span>
              </span>
              <span style={{ textAlign: "right", fontFamily: JET, fontWeight: 600, color: pnl == null ? K.DIM : pnl >= 0 ? K.UP : K.DN }}>{pnl == null ? "—" : signedUsd(pnl)}</span>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: K.FAINT }}>Unrealized, after one side of fees. Paper only; nothing is executed. Not financial advice.</div>
    </section>
  );
}

function TrackRecord({ track, feed, prices, onSelect }: { track: Track | null | "offline"; feed: ServerEvent[]; prices: Record<string, number>; onSelect: (t: string) => void }) {
  if (track === null) return null;
  if (track === "offline")
    return (
      <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <SectionHead n="04" title="Scanner track record" note="our server scanner is offline right now; the rest of the page still works" />
      </section>
    );
  const t = track.totals;
  const since = track.since ? new Date(track.since).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET" : "—";
  const stat = (k: string, v: string, c: string, s: string) => (
    <div style={{ background: K.CARD, border: `1px solid ${K.LINE}`, padding: 20, display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 13, color: K.DIM }}>{k}</span>
      <span style={{ fontFamily: JET, fontSize: 28, fontWeight: 800, lineHeight: 1.1, color: c }}>{v}</span>
      <span style={{ fontSize: 13, color: K.MID }}>{s}</span>
    </div>
  );
  const openRows = track.trades.filter((x) => x.status === "open");
  const unreal = openRows.reduce((s, x) => {
    const p = prices[x.ticker];
    return p ? s + (x.side === "BUY" ? (p - x.entry) * x.qty : (x.entry - p) * x.qty) : s;
  }, 0);
  const cols = "56px 64px minmax(0,1.4fr) minmax(0,1fr) 110px";
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionHead n="04" title="Scanner track record" note={`runs by itself on our server every ${track.scanEveryMin} min · live since ${since} · paper only`} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,190px),1fr))", gap: 12 }}>
        {stat("Scans", String(t.scans), K.FG, `${t.llmCalls} AI calls · $${t.llmUsd.toFixed(2)} total`)}
        {stat("Paper trades", String(t.trades), K.FG, t.trades ? `${t.open} open · ${t.closed} closed · ${t.wins} won` : "none yet: waiting for a FADE setup")}
        {stat("Net after fees", t.closed ? signedUsd(t.netUsd) : "$0.00", t.netUsd > 0 ? K.UP : t.netUsd < 0 ? K.DN : K.FG, t.closed ? `on $${(t.closed * t.stakeUsd).toLocaleString()} closed` : openRows.length ? `open: ${signedUsd(unreal)} unrealized` : "no closed trades yet")}
        {stat('"Respect" checks', `${t.callsHeld} / ${t.callsChecked}`, K.SIG, t.calls - t.callsChecked ? `${t.calls - t.callsChecked} waiting for the next open` : "gaps that held at the open")}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {track.signals.map((s) => (
          <button key={s.ticker} onClick={() => onSelect(s.ticker)} title={s.why} style={{ font: "inherit", fontSize: 12, fontFamily: JET, padding: "5px 9px", cursor: "pointer", background: K.CARD, color: s.signal === "NO TRADE" ? K.DIM : K.SIG, border: `1px solid ${s.signal === "FADE" ? K.SIG : K.LINE}` }}>
            {s.ticker} · {s.signal === "FADE" ? `FADE ${s.side}` : s.signal}
          </button>
        ))}
      </div>

      {(track.trades.length > 0 || track.calls.length > 0) && (
        <div style={{ border: `1px solid ${K.LINE}`, overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 14, padding: "10px 18px", fontSize: 12, fontWeight: 600, letterSpacing: ".06em", color: K.DIM, borderBottom: `1px solid ${K.LINE}`, minWidth: 620 }}>
            <span>SIDE</span><span>STOCK</span><span>ENTRY</span><span>SETTLES AT NYSE OPEN</span><span style={{ textAlign: "right" }}>RESULT</span>
          </div>
          {track.trades.map((x) => {
            const p = prices[x.ticker];
            const live = x.status === "open" && p ? (x.side === "BUY" ? (p - x.entry) * x.qty : (x.entry - p) * x.qty) : null;
            return (
              <div key={`t${x.id}`} style={{ display: "grid", gridTemplateColumns: cols, gap: 14, alignItems: "center", padding: "10px 18px", borderBottom: `1px solid ${K.LINE2}`, fontSize: 14, minWidth: 620 }}>
                <span style={{ fontFamily: JET, fontSize: 12, fontWeight: 800, textAlign: "center", padding: "2px 0", background: x.side === "BUY" ? K.UP : K.DN, color: K.BG }}>{x.side}</span>
                <span style={{ fontFamily: JET, fontWeight: 600 }}>{x.ticker}</span>
                <span style={{ color: K.FG2 }}>{x.qty.toFixed(3)} at {usd(x.entry)} <span style={{ color: K.DIM, fontSize: 12 }}>· {et(x.opened_at)} ET · gap {pct(x.gap_pct)}</span></span>
                <span style={{ color: K.FG2 }}>{x.exit != null ? `${usd(x.exit)} · ${et(x.settle_at)}` : `${et(x.settle_at)} ET`}</span>
                <span style={{ textAlign: "right", fontFamily: JET, fontWeight: 600, color: x.net_usd != null ? (x.net_usd >= 0 ? K.UP : K.DN) : live != null ? (live >= 0 ? K.UP : K.DN) : K.DIM }}>
                  {x.net_usd != null ? signedUsd(x.net_usd) : live != null ? `${signedUsd(live)} open` : "open"}
                </span>
              </div>
            );
          })}
          {track.calls.map((c) => (
            <div key={`c${c.id}`} style={{ display: "grid", gridTemplateColumns: cols, gap: 14, alignItems: "center", padding: "10px 18px", borderBottom: `1px solid ${K.LINE2}`, fontSize: 14, minWidth: 620 }}>
              <span style={{ fontFamily: JET, fontSize: 11, fontWeight: 800, textAlign: "center", padding: "2px 0", border: `1px solid ${K.SIG}`, color: K.SIG }}>HOLD</span>
              <span style={{ fontFamily: JET, fontWeight: 600 }}>{c.ticker}</span>
              <span style={{ color: K.FG2 }}>Respect the gap · token {usd(c.price)} vs close {usd(c.ref_close)} <span style={{ color: K.DIM, fontSize: 12 }}>· {et(c.at)} ET</span></span>
              <span style={{ color: K.FG2 }}>{c.open_price != null ? `opened ${usd(c.open_price)}` : `${et(c.settle_at)} ET`}</span>
              <span style={{ textAlign: "right", fontFamily: JET, fontWeight: 600, color: c.held == null ? K.DIM : c.held ? K.FG : K.DN }}>{c.held == null ? "waiting" : c.held ? "held ✓" : "closed ✗"}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={label}>SCANNER LOG</span>
        <div style={{ border: `1px solid ${K.LINE}`, maxHeight: 280, overflowY: "auto" }}>
          {feed.length === 0 && <div style={{ padding: 14, fontSize: 14, color: K.DIM }}>Nothing logged yet.</div>}
          {feed.map((e) => {
            const col = e.kind === "NEWS" ? K.AMB : e.kind === "ON-CHAIN" ? K.VIO : e.side === "BUY" ? K.UP : e.side === "SELL" ? K.DN : K.SIG;
            return (
              <a key={e.id} href={e.url || undefined} target="_blank" rel="noreferrer" style={{ display: "grid", gridTemplateColumns: "92px 70px 52px minmax(0,1fr)", gap: 10, padding: "8px 14px", borderBottom: `1px solid ${K.LINE2}`, fontSize: 13, color: K.FG, textDecoration: "none" }}>
                <span style={{ fontFamily: JET, fontSize: 11, color: K.FAINT }}>{et(e.at)}</span>
                <span style={{ fontFamily: JET, fontSize: 11, fontWeight: 800, color: col }}>{e.kind}</span>
                <span style={{ fontFamily: JET, fontSize: 12 }}>{e.ticker}</span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title}<span style={{ color: K.DIM }}> · {e.sub}</span></span>
              </a>
            );
          })}
        </div>
      </div>
      <div style={{ fontSize: 12, color: K.FAINT }}>
        Paper trades are opened automatically on FADE signals while the NYSE is closed ($1,000 each, real Jupiter price impact) and settled at the next NYSE open using the token&apos;s real price then, after {FEE_PER_SIDE_PCT}% fees per side. Nothing is ever executed. Not financial advice.
      </div>
    </section>
  );
}
