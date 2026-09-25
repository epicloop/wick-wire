"use client";

import { liveDepth, signalFor, FEE_PER_SIDE_PCT, MIN_GAP_PCT, type BacktestRow, type Signal } from "@/lib/signal";
import type { BoardPayload, TickerReport } from "@/lib/types";
import { colorOf, fmtPct, fmtUsd } from "./ui";

const CHIP: Record<Signal, React.CSSProperties> = {
  FADE: { background: "var(--violet)", borderColor: "var(--violet)", color: "var(--bg)" },
  RESPECT: { background: "var(--amber)", borderColor: "var(--amber)", color: "var(--bg)" },
  "NO TRADE": { background: "transparent", borderColor: "var(--rule)", color: "var(--muted)" },
};

export function SignalChip({ s, side }: { s: Signal; side?: "BUY" | "SELL" | null }) {
  return (
    <span className="chip" style={CHIP[s]}>
      {s}
      {side ? ` · ${side}` : ""}
    </span>
  );
}

const Head = ({ children }: { children: React.ReactNode }) => (
  <div className="rule-b pad-x" style={{ display: "flex", alignItems: "baseline", gap: 16, padding: "20px 32px", flexWrap: "wrap" }}>
    {children}
  </div>
);

const RULES = `FADE = gap ≥ ${MIN_GAP_PCT}% that is mostly on-chain/unexplained with enough depth (expect it to close at the open) · RESPECT = news explains it · NO TRADE = too small, too thin or mixed.`;
const NFA = "Paper only: Wick Wire never trades or signs anything. Not financial advice.";

/** Live: today's signal per stock, with the real Jupiter $1,000 quote it would use. */
export function LiveSignals({ reports }: { reports: TickerReport[] }) {
  if (!reports.length) return null;
  return (
    <section className="rule-t">
      <Head>
        <span className="label-strong" style={{ color: "var(--violet)" }}>GAP SIGNALS · PAPER ONLY</span>
        <span className="muted" style={{ fontSize: 11 }}>{RULES}</span>
      </Head>
      {reports.map((r) => {
        const s = signalFor(r, liveDepth(r));
        return (
          <div key={r.ticker} className="rule-b pad-x" style={{ display: "grid", gridTemplateColumns: "70px 80px 150px minmax(0,1fr) minmax(0,1fr)", gap: 16, padding: "12px 32px", alignItems: "center", fontSize: 12 }}>
            <span className="display" style={{ fontWeight: 800, fontSize: 20 }}>{r.ticker}</span>
            <span className="num" style={{ color: colorOf(r.gapPct), fontWeight: 600 }}>{fmtPct(r.gapPct)}</span>
            <SignalChip s={s.signal} side={s.side} />
            <span className="muted">{s.why}</span>
            <span className="num">
              {r.thin ? (
                <>
                  Jupiter $1,000 USDC → {r.token}: impact <b style={{ color: r.thin.impactPct > 1 ? "var(--amber)" : "var(--ink)" }}>{r.thin.impactPct.toFixed(2)}%</b> <span className="muted">via {r.thin.route}</span>
                </>
              ) : (
                <span className="muted">Jupiter quote unavailable</span>
              )}
            </span>
          </div>
        );
      })}
      <div className="muted pad-x" style={{ padding: "12px 32px", fontSize: 11 }}>{NFA} Quotes are read-only Jupiter quotes; nothing is executed.</div>
    </section>
  );
}

/** Replay: the Sunday-night signal vs the real Monday open, after fees. */
export function ReplayBacktest({ bt }: { bt: NonNullable<BoardPayload["backtest"]> }) {
  const rows = bt.rows;
  const traded = rows.filter((r) => r.netPct != null);
  const closed = (r: BacktestRow) =>
    r.gapClosedPct == null ? "—" : r.gapClosedPct >= 0 ? `${Math.min(100, Math.round(r.gapClosedPct))}% closed` : `widened ${Math.round(-r.gapClosedPct)}%`;
  const cols = "70px 150px 90px 90px 90px 110px 100px 120px minmax(0,1fr)";
  return (
    <section className="rule-t">
      <Head>
        <span className="label-strong" style={{ color: "var(--violet)" }}>REPLAY EXAMPLE (1 WEEKEND, 8 STOCKS)</span>
        <span className="muted" style={{ fontSize: 11 }}>Signal at Sun 20 Sep 8 PM ET → token price at {bt.exitLabel}. Fees assumed {FEE_PER_SIDE_PCT}% per side; price impact not recorded historically.</span>
      </Head>
      <div className="rule-b pad-x label" style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "10px 32px", overflowX: "auto" }}>
        <span>TOKEN</span><span>SIGNAL</span><span>FRI CLOSE</span><span>SUN 8 PM</span><span>MON OPEN</span><span>GAP AT OPEN</span><span>PAPER P&amp;L</span><span>IF FADED ANYWAY</span><span>WHY</span>
      </div>
      {rows.map((r) => (
        <div key={r.ticker} className="rule-b pad-x num" style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "12px 32px", alignItems: "center", fontSize: 12, overflowX: "auto" }}>
          <span className="display" style={{ fontWeight: 800, fontSize: 20 }}>{r.ticker}</span>
          <SignalChip s={r.signal} side={r.side} />
          <span>{fmtUsd(r.refClose)}</span>
          <span>{fmtUsd(r.entry)}</span>
          <span title={r.exitSource}>{fmtUsd(r.exit)}</span>
          <span className="muted">{closed(r)}</span>
          <span style={{ fontWeight: 600, color: r.netPct == null ? "var(--muted)" : colorOf(r.netPct) }}>{r.netPct == null ? "no position" : fmtPct(r.netPct, 2)}</span>
          <span style={{ color: colorOf(r.fadeAnywayNetPct) }}>{fmtPct(r.fadeAnywayNetPct, 2)}</span>
          <span className="muted">{r.why}</span>
        </div>
      ))}
      <div className="pad-x" style={{ padding: "14px 32px", fontSize: 12, lineHeight: 1.6 }}>
        <span className="serif" style={{ fontSize: 17 }}>
          {traded.length === 0
            ? `No FADE setups this weekend: every gap was under ${MIN_GAP_PCT}% or explained by news, so the signal stayed out. `
            : `${traded.length} FADE trade${traded.length > 1 ? "s" : ""}, net ${fmtPct(traded.reduce((s, r) => s + (r.netPct ?? 0), 0) / traded.length, 2)} on average after fees. `}
          {(() => {
            const all = rows.filter((r) => r.fadeAnywayNetPct != null);
            const losers = all.filter((r) => (r.fadeAnywayNetPct ?? 0) < 0).length;
            return all.length ? `Fading every gap blindly would have lost money on ${losers} of ${all.length} stocks after fees.` : "";
          })()}
        </span>
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>One weekend is an example, not evidence of an edge. {NFA}</div>
      </div>
    </section>
  );
}
