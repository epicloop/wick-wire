"use client";

import type { ChartPayload } from "@/lib/types";
import { countdown } from "./ui";

export type Pin = { label: string; time: number; kind: "news" | "chain"; strong: boolean };

const W = 1376, H = 430, TOP = 60, BOT = 318, VB = 400, VH = 46;

export default function Chart(props: {
  chart: ChartPayload;
  from: number;
  to: number;
  nextOpen: number | null; // unix sec
  refPrice: number | null;
  refLabel: string;
  lastPrice: number | null;
  pins: Pin[];
  clockNow: number; // ms
}) {
  const { chart, from, to, refPrice, lastPrice } = props;
  const cs = chart.candles.filter((c) => c.t >= from - chart.resolution * 60 && c.t <= to);
  if (!cs.length) return <p className="muted">No candles in this window.</p>;

  const futureW = props.nextOpen && props.nextOpen > to ? Math.min(W * 0.22, 290) : 0;
  const plotW = W - futureW - (futureW ? 0 : 100);
  const X = (t: number) => ((t - from) / (to - from || 1)) * plotW;
  const vals = cs.flatMap((c) => [c.h, c.l]).concat(refPrice ?? [], lastPrice ?? []);
  const hi = Math.max(...vals), lo = Math.min(...vals), pad = (hi - lo || hi * 0.01) * 0.08;
  const Y = (v: number) => TOP + ((hi + pad - v) / (hi - lo + 2 * pad)) * (BOT - TOP);
  const step = Math.max(1.2, (chart.resolution * 60 * plotW) / (to - from || 1));
  const bw = Math.max(1, step * 0.62);
  const vmax = Math.max(...cs.map((c) => c.v ?? 0)) || 1;

  let wu = "", wd = "", bu = "", bd = "", vu = "", vd = "";
  for (const c of cs) {
    const x = X(c.t) + step / 2, up = c.c >= c.o;
    const w = `M${x.toFixed(1)} ${Y(c.h).toFixed(1)}V${Y(c.l).toFixed(1)}`;
    const yt = Y(Math.max(c.o, c.c)), bh = Math.max(1.2, Math.abs(Y(c.o) - Y(c.c)));
    const b = `M${(x - bw / 2).toFixed(1)} ${yt.toFixed(1)}h${bw.toFixed(1)}v${bh.toFixed(1)}h${(-bw).toFixed(1)}Z`;
    const vh = ((c.v ?? 0) / vmax) * VH;
    const v = vh > 0 ? `M${(x - bw / 2).toFixed(1)} ${VB}v${(-vh).toFixed(1)}h${bw.toFixed(1)}v${vh.toFixed(1)}Z` : "";
    if (up) { wu += w; bu += b; vu += v; } else { wd += w; bd += b; vd += v; }
  }

  const priceAt = (t: number) => cs.reduce((best, c) => (Math.abs(c.t - t) < Math.abs(best.t - t) ? c : best), cs[0]);
  const days: { x: number; label: string }[] = [];
  const wdFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" });
  const hrFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" });
  for (let t = Math.ceil(from / 3600) * 3600; t < to; t += 3600) {
    if (Number(hrFmt.format(t * 1000)) === 0 && X(t) > 80 && X(t) < plotW - 60) days.push({ x: X(t), label: wdFmt.format(t * 1000).toUpperCase() });
  }
  const lastY = lastPrice != null ? Y(lastPrice) : null;
  const futX = plotW;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }} role="img" aria-label="Price candles over the window with event pins">
      {futureW > 0 && (
        <>
          <rect x={futX} y={44} width={W - futX} height={VB - 44} fill="var(--surface)" />
          <line x1={futX} x2={futX} y1={44} y2={VB} stroke="var(--rule)" />
          <text x={futX + 18} y={80} fontFamily="var(--f-mono)" fontSize="12" fontWeight="600" fill="var(--amber)" letterSpacing="1">NYSE OPENS</text>
          <text x={futX + 18} y={98} fontFamily="var(--f-mono)" fontSize="12" fill="var(--muted)">
            {new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }).format(props.nextOpen! * 1000)} ET
          </text>
          <text x={futX + 18} y={136} fontFamily="var(--f-display)" fontSize="34" fontWeight="800" fill="var(--ink)">{countdown(props.nextOpen! * 1000 - props.clockNow)}</text>
          <text x={futX + 18} y={160} fontFamily="var(--f-mono)" fontSize="11" fill="var(--muted)">gap either closes or holds</text>
        </>
      )}
      {refPrice != null && (
        <>
          <line x1={0} x2={futX} y1={Y(refPrice)} y2={Y(refPrice)} stroke="var(--amber)" strokeWidth="1.5" strokeDasharray="6 5" />
          <text x={6} y={Y(refPrice) - 8} fontFamily="var(--f-mono)" fontSize="11" fill="var(--amber)">{props.refLabel} {refPrice.toFixed(2)}</text>
        </>
      )}
      {props.pins.map((p) => {
        const x = X(p.time) + step / 2;
        if (x < 0 || x > futX) return null;
        const c = priceAt(p.time);
        return p.kind === "news" ? (
          <g key={p.label}>
            <path d={`M${x.toFixed(1)} 36V${(Y(c.h) - 4).toFixed(1)}`} stroke="var(--muted)" strokeDasharray="2 3" />
            <circle cx={x} cy={22} r={13} fill={p.strong ? "var(--amber)" : "var(--bg)"} stroke={p.strong ? "var(--amber)" : "var(--ink)"} strokeWidth="1.5" />
            <text x={x} y={27} fontFamily="var(--f-mono)" fontSize="13" fontWeight="600" fill={p.strong ? "var(--bg)" : "var(--ink)"} textAnchor="middle">{p.label}</text>
          </g>
        ) : (
          <g key={p.label}>
            <path d={`M${x.toFixed(1)} 332V${(Y(c.l) + 4).toFixed(1)}`} stroke="var(--violet)" strokeDasharray="2 3" />
            <rect x={x - 11} y={332} width={22} height={22} fill={p.strong ? "var(--violet)" : "var(--bg)"} stroke="var(--violet)" strokeWidth="1.5" />
            <text x={x} y={348} fontFamily="var(--f-mono)" fontSize="12" fontWeight="600" fill={p.strong ? "var(--bg)" : "var(--violet)"} textAnchor="middle">{p.label}</text>
          </g>
        );
      })}
      <path d={wu} stroke="var(--up)" strokeWidth="1.5" />
      <path d={wd} stroke="var(--down)" strokeWidth="1.5" />
      <path d={bu} fill="var(--up)" />
      <path d={bd} fill="var(--down)" />
      <path d={vu} fill="var(--up)" opacity=".35" />
      <path d={vd} fill="var(--down)" opacity=".35" />
      {lastY != null && (
        <>
          <line x1={0} x2={futX} y1={lastY} y2={lastY} stroke={lastPrice! >= (refPrice ?? lastPrice!) ? "var(--up)" : "var(--down)"} strokeDasharray="2 3" />
          <rect x={W - 90} y={lastY - 11} width={84} height={22} fill={lastPrice! >= (refPrice ?? lastPrice!) ? "var(--up)" : "var(--down)"} />
          <text x={W - 48} y={lastY + 4} fontFamily="var(--f-mono)" fontSize="12" fontWeight="600" fill="var(--bg)" textAnchor="middle">{lastPrice!.toFixed(2)}</text>
        </>
      )}
      <text x={W} y={TOP + 4} fontFamily="var(--f-mono)" fontSize="11" fill="var(--muted)" textAnchor="end">{(hi + pad).toFixed(2)}</text>
      <text x={W} y={BOT + 4} fontFamily="var(--f-mono)" fontSize="11" fill="var(--muted)" textAnchor="end">{(lo - pad).toFixed(2)}</text>
      <line x1={0} x2={W} y1={VB} y2={VB} stroke="var(--rule)" />
      <text x={0} y={420} fontFamily="var(--f-mono)" fontSize="11" fill="var(--amber)">
        {new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }).format(from * 1000).toUpperCase()} · BELL
      </text>
      {days.map((d) => (
        <text key={d.x} x={d.x} y={420} fontFamily="var(--f-mono)" fontSize="11" fill="var(--muted)">{d.label}</text>
      ))}
      <text x={futX} y={420} fontFamily="var(--f-mono)" fontSize="11" fill="var(--ink)" textAnchor="end">NOW</text>
    </svg>
  );
}
