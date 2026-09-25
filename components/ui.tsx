"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { BoardPayload, Flag, Mode } from "@/lib/types";

export const fmtPct = (x: number | null | undefined, dp = 1) => (x == null ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(dp)}%`);
export const fmtUsd = (x: number | null | undefined) => (x == null ? "—" : `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const fmtBig = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`);
export const pctInt = (p: number | null | undefined) => (p == null ? "—" : `${Math.round(p * 100)}%`);
export const colorOf = (x: number | null | undefined) => (x == null ? "var(--muted)" : x >= 0 ? "var(--up)" : "var(--down)");

const etFmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", ...o });
export const etDay = (sec: number) => etFmt({ weekday: "short" }).format(sec * 1000).toUpperCase();
export const etTime = (sec: number) => etFmt({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(sec * 1000);
export const etWhen = (sec: number) => `${etDay(sec)} ${etTime(sec)}`;
export const etLong = (sec: number) => etFmt({ weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(sec * 1000) + " ET";

export function useNow(tickMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(t);
  }, [tickMs]);
  return now;
}

export function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (v: number) => String(v).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

export function stateLabel(state: BoardPayload["market"]["state"]) {
  return state === "OPEN"
    ? "NYSE OPEN · TOKENS TRACK THE TAPE"
    : state === "AFTER-HOURS"
      ? "AFTER-HOURS · NEXT OPEN IN"
      : state === "OVERNIGHT"
        ? "OVERNIGHT · OPENS IN"
        : "NYSE CLOSED · OPENS IN";
}

/** Market clock. In replay the clock is frozen at the end of the recorded window. */
export function useClock(market: BoardPayload["market"] | null, frozenAt: number | null) {
  const live = useNow();
  if (!market) return { label: "", cd: "" };
  const now = frozenAt ?? live;
  return {
    label: stateLabel(market.state),
    cd: market.state === "OPEN" || !market.nextOpen ? "" : countdown(market.nextOpen - now),
  };
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <Link href="/" className="logo" aria-label="Wick Wire home">
      <svg width={size / 2} height={size + 2} viewBox="0 0 14 30" aria-hidden>
        <line x1="7" y1="0" x2="7" y2="30" stroke="#EDEAE2" strokeWidth="1.5" />
        <rect x="1" y="9" width="12" height="13" fill="#FF6B57" />
      </svg>
      <b>WICK WIRE</b>
    </Link>
  );
}

export function Header(props: {
  mode: Mode;
  setMode: (m: Mode) => void;
  market: BoardPayload["market"] | null;
  frozenAt: number | null;
  back?: boolean;
}) {
  const { label, cd } = useClock(props.market, props.frozenAt);
  return (
    <>
      <header className="hdr rule-b">
        <Logo />
        {props.back ? (
          <Link href={props.mode === "replay" ? "/desk?mode=replay" : "/desk"} className="tagline" style={{ fontSize: 12, color: "var(--muted)", textDecoration: "none", marginRight: "auto" }}>
            ← ALL MOVERS
          </Link>
        ) : (
          <div className="tagline muted" style={{ fontSize: 12, marginRight: "auto" }}>
            your bag moved · here&apos;s why
          </div>
        )}
        {label && (
          <div className="badge">
            <i />
            <span>{label}</span>
            <span className="num" style={{ fontSize: 13, fontWeight: 600 }}>
              {cd}
            </span>
          </div>
        )}
        <div className="seg" role="group" aria-label="Data mode">
          <button aria-pressed={props.mode === "live"} onClick={() => props.setMode("live")}>
            LIVE
          </button>
          <button aria-pressed={props.mode === "replay"} onClick={() => props.setMode("replay")}>
            REPLAY
          </button>
        </div>
        <button
          className="mtoggle"
          onClick={() => props.setMode(props.mode === "replay" ? "live" : "replay")}
          style={{ marginLeft: "auto", fontSize: 11, letterSpacing: ".08em", minHeight: 44, padding: "0 12px", border: "1px solid var(--rule)", background: "transparent", color: "var(--ink)", cursor: "pointer" }}
        >
          {props.mode === "replay" ? "REPLAY" : "LIVE"} ⇄
        </button>
      </header>
      {label && (
        <div className="mstrip num">
          <span>{label}</span>
          <span>{cd}</span>
        </div>
      )}
      {props.mode === "replay" && (
        <div className="strip">
          <span>REPLAY</span>
          <span>RECORDED WEEKEND OF 19–20 SEP 2026 · REAL HISTORICAL DATA</span>
          <span style={{ marginLeft: "auto" }}>TIMES IN ET</span>
        </div>
      )}
    </>
  );
}

export function FlagChip({ flag }: { flag: Flag }) {
  return <span className={`chip chip-${flag.replace(/ /g, "")}`}>{flag === "UNSCORED" ? "NOT SCORED" : flag}</span>;
}

export function SplitBar({ news, chain, width = 120, height = 9 }: { news: number; chain: number; width?: number | string; height?: number }) {
  return (
    <div className="split" style={{ width, height }}>
      <div style={{ width: `${news * 100}%`, background: "var(--amber)" }} />
      <div style={{ width: `${chain * 100}%`, background: "var(--violet)" }} />
    </div>
  );
}

/** Token range over the window, body from reference to now, amber tick at the reference. */
export function Wick({ lo, hi, from, to, width = 230, height = 36, fluid = false }: { lo: number; hi: number; from: number; to: number; width?: number; height?: number; fluid?: boolean }) {
  const a = Math.min(lo, from, to) * 0.999, b = Math.max(hi, from, to) * 1.001;
  const X = (v: number) => 4 + ((v - a) / (b - a || 1)) * (width - 8);
  const cx = X(from), nx = X(to), mid = height / 2, bh = height * 0.44;
  const color = to >= from ? "var(--up)" : "var(--down)";
  return (
    <svg width={fluid ? "100%" : width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block" }} aria-hidden>
      <line x1={X(lo)} x2={X(hi)} y1={mid} y2={mid} stroke="var(--muted)" strokeWidth="1.5" />
      <rect x={Math.min(cx, nx)} y={mid - bh / 2} width={Math.max(2, Math.abs(nx - cx))} height={bh} fill={color} />
      <line x1={cx} x2={cx} y1={2} y2={height - 2} stroke="var(--amber)" strokeWidth="2" />
    </svg>
  );
}

export function Footer({ mode, sources }: { mode: Mode; sources: string }) {
  return (
    <footer className="foot rule-t">
      <span style={{ marginRight: "auto" }}>Not financial advice. Tokenized stocks are not available to US persons and are restricted in some regions.</span>
      <span>
        {sources}
        {mode === "replay" ? " · Replay data" : ""}
      </span>
    </footer>
  );
}

export const SOURCES_LINE = "Prices: Pyth (entitled feeds), Jupiter · Pools: DexScreener, GeckoTerminal · Supply: Solana RPC · News: Finnhub · Scoring: Claude Haiku";

export function useMode(): [Mode, (m: Mode) => void] {
  const [mode, set] = useState<Mode>("live");
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get("mode");
    if (m === "replay") set("replay");
  }, []);
  const setMode = (m: Mode) => {
    set(m);
    const u = new URL(window.location.href);
    if (m === "replay") u.searchParams.set("mode", "replay");
    else u.searchParams.delete("mode");
    window.history.replaceState(null, "", u);
  };
  return [mode, setMode];
}
