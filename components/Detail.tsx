"use client";

import { useEffect, useState } from "react";
import type { BoardPayload, ChartPayload, TickerReport } from "@/lib/types";
import { liveDepth, replayDepth, signalFor } from "@/lib/signal";
import Chart, { type Pin } from "./Chart";
import { SignalChip } from "./Signals";
import { FlagChip, Footer, Header, SOURCES_LINE, colorOf, etLong, etWhen, fmtBig, fmtPct, fmtUsd, pctInt, useMode, useNow } from "./ui";

const CAT: Record<string, string> = {
  earnings: "EARNINGS", guidance: "GUIDANCE", analyst: "ANALYST", macro: "MACRO", legal_regulatory: "LEGAL", product: "PRODUCT",
  m_and_a: "M&A", sector: "SECTOR", onchain: "ON-CHAIN", other: "OTHER",
};
const KIND: Record<string, string> = { whale_trade: "WHALE", volume_spike: "VOLUME SPIKE", pool_divergence: "POOL ≠ REF", paired_token: "MEMECOIN PAIR" };

export default function Detail({ ticker }: { ticker: string }) {
  const [mode, setMode] = useMode();
  const [r, setR] = useState<TickerReport | null>(null);
  const [market, setMarket] = useState<BoardPayload["market"] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<5 | 15 | 60>(15);
  const [chart, setChart] = useState<ChartPayload | null | "loading">("loading");
  const liveNow = useNow();

  useEffect(() => {
    let alive = true;
    setR(null);
    setErr(null);
    const q = mode === "replay" ? "?mode=replay" : "";
    fetch(`/api/stock/${ticker}${q}`)
      .then(async (x) => {
        const j = await x.json();
        if (!x.ok) throw new Error(j.error ?? `HTTP ${x.status}`);
        return j as TickerReport;
      })
      .then((j) => alive && setR(j))
      .catch((e) => alive && setErr(e.message));
    fetch(`/api/market${q}`)
      .then((x) => (x.ok ? x.json() : null))
      .then((j) => alive && setMarket(j));
    return () => {
      alive = false;
    };
  }, [ticker, mode]);

  useEffect(() => {
    let alive = true;
    setChart("loading");
    fetch(`/api/chart/${ticker}?res=${res}${mode === "replay" ? "&mode=replay" : ""}`)
      .then((x) => (x.ok ? x.json() : null))
      .then((j) => alive && setChart(j))
      .catch(() => alive && setChart(null));
    return () => {
      alive = false;
    };
  }, [ticker, mode, res]);

  const frozenAt = mode === "replay" && r ? r.window.to * 1000 : null;
  const clockNow = frozenAt ?? liveNow;

  const heads = r ? [...r.headlines].sort((a, b) => (b.score?.caused_move ?? -1) - (a.score?.caused_move ?? -1)) : [];
  const pinNo = new Map(heads.map((h, i) => [h.ref, i + 1]));
  const chain = r ? [...r.onchain].sort((a, b) => (b.score?.caused_move ?? -1) - (a.score?.caused_move ?? -1)) : [];
  const pins: Pin[] = [
    ...heads.slice(0, 4).map((h, i) => ({ label: String(i + 1), time: h.time, kind: "news" as const, strong: i === 0 && (h.score?.caused_move ?? 0) >= 0.3 })),
    ...chain.filter((e) => e.kind !== "pool_divergence" && e.kind !== "paired_token").slice(0, 3).map((e, i) => ({ label: e.id, time: e.time, kind: "chain" as const, strong: i === 0 && (e.score?.caused_move ?? 0) >= 0.3 })),
  ];
  const refP = r?.reference?.price ?? null, nowP = r?.tokenPrice?.price ?? null;
  const d = r?.driver;
  const totalVol = r ? r.pools.reduce((s, p) => s + p.volume24hUsd, 0) || 1 : 1;
  const paired = r?.pools.filter((p) => p.paired && p.volume24hUsd > 0).slice(0, 4) ?? [];

  return (
    <div className="shell">
      <Header mode={mode} setMode={setMode} market={market} frozenAt={frozenAt} back />
      {err && (
        <div style={{ padding: 32 }}>
          <div className="label" style={{ color: "var(--down)" }}>UNAVAILABLE</div>
          <p className="serif" style={{ fontSize: 20 }}>This report could not be built right now ({err}).</p>
        </div>
      )}
      {!r && !err && (
        <div style={{ padding: 32 }}>
          <div className="big-t pulse">{ticker}</div>
          <p className="muted" style={{ marginTop: 16 }}>Reading prices, pools, trades and headlines…</p>
        </div>
      )}
      {r && (
        <>
          <section className="top rule-b">
            <div className="rule-r pad-x" style={{ padding: "36px 32px", display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 18, flexWrap: "wrap" }}>
                <div className="big-t">{r.ticker}</div>
                <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
                  {r.token} on Solana
                  <br />
                  {r.name}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 40, flexWrap: "wrap" }}>
                <div className="big-gap" style={{ color: colorOf(r.gapPct) }}>{fmtPct(r.gapPct)}</div>
                <div className="num" style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 6 }}>
                  <div>
                    <div className="label" style={{ color: "var(--amber)" }}>{r.reference ? `${r.reference.label} · ${etWhen(r.reference.time)} ET` : "REFERENCE"}</div>
                    <div style={{ fontSize: 22, fontWeight: 500 }}>{r.reference ? fmtUsd(r.reference.price) : "unavailable"}</div>
                  </div>
                  <div>
                    <div className="label">{r.tokenPrice?.label ?? `${r.token} NOW`}</div>
                    <div style={{ fontSize: 22, fontWeight: 500 }}>{r.tokenPrice ? fmtUsd(r.tokenPrice.price) : "unavailable"}</div>
                  </div>
                </div>
              </div>
              <div className="muted" style={{ fontSize: 11 }}>Window: {r.window.label}</div>
            </div>
            <div className="pad-x" style={{ padding: "36px 32px", display: "flex", flexDirection: "column", gap: 16, background: "var(--surface)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, letterSpacing: ".1em", flexWrap: "wrap" }}>
                <FlagChip flag={r.flag} />
                <span className="muted">{r.categoryLabel}</span>
              </div>
              <div className="explain">
                {r.explanation.length ? (
                  r.explanation.map((s, i) => (
                    <span key={i} className={s.ref ? (s.ref.startsWith("N") ? "u-news" : "u-chain") : undefined}>
                      {s.text}
                      {i < r.explanation.length - 1 && !/\s$/.test(s.text) && !/^\s/.test(r.explanation[i + 1].text) ? " " : ""}
                    </span>
                  ))
                ) : (
                  <span className="muted">Explanation unavailable: {r.unavailable.join(", ") || "not scored"}.</span>
                )}
              </div>
              {(() => {
                const sg = signalFor(r, r.mode === "replay" ? replayDepth(r) : liveDepth(r));
                return (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, flexWrap: "wrap" }}>
                    <span className="label">GAP SIGNAL · PAPER ONLY</span>
                    <SignalChip s={sg.signal} side={sg.side} />
                    <span className="muted">{sg.why} · not financial advice</span>
                  </div>
                );
              })()}
              {d && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: "auto" }}>
                  <div className="split" style={{ height: 16 }}>
                    <div style={{ width: `${d.news * 100}%`, background: "var(--amber)" }} />
                    <div style={{ width: `${d.onchain * 100}%`, background: "var(--violet)" }} />
                  </div>
                  <div className="num" style={{ display: "flex", gap: 18, fontSize: 12, flexWrap: "wrap" }}>
                    <span style={{ color: "var(--amber)" }}>NEWS {pctInt(d.news)}</span>
                    <span style={{ color: "var(--violet)" }}>ON-CHAIN {pctInt(d.onchain)}</span>
                    <span className="muted">UNEXPLAINED {pctInt(d.unexplained)}</span>
                    <span className="muted" style={{ marginLeft: "auto" }}>{r.scorer ? `${r.scorer.name} · ${r.scorer.latencyMs} ms · $${r.scorer.costUsd.toFixed(4)}` : ""}</span>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="pad-x" style={{ padding: "20px 32px 8px", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
            <span className="label-strong">THE WINDOW, CANDLE BY CANDLE</span>
            <span className="muted" style={{ fontSize: 11, marginRight: "auto" }}>
              {chart && chart !== "loading" ? `${chart.resolution}-min candles from ${chart.source === "pyth" ? "Pyth" : "the main DEX pool (GeckoTerminal)"}` : "candles"} ·{" "}
              <span style={{ color: "var(--amber)" }}>●</span> headlines · <span style={{ color: "var(--violet)" }}>■</span> on-chain events
            </span>
            <div className="seg">
              {([5, 15, 60] as const).map((x) => (
                <button key={x} aria-pressed={res === x} onClick={() => setRes(x)} style={{ padding: "6px 10px" }}>
                  {x === 60 ? "1H" : `${x}M`}
                </button>
              ))}
            </div>
          </section>
          <section className="pad-x" style={{ padding: "0 32px 24px" }}>
            {chart === "loading" && <div className="skeleton" style={{ height: 280 }} />}
            {chart === null && <p className="muted">Chart unavailable for this window.</p>}
            {chart && chart !== "loading" && (
              <Chart
                chart={chart}
                from={r.window.from}
                to={r.window.to}
                nextOpen={market?.nextOpen ? Math.floor(market.nextOpen / 1000) : null}
                refPrice={refP}
                refLabel={r.reference?.source === "pyth" ? "CLOSE" : "REF"}
                lastPrice={nowP}
                pins={pins}
                clockNow={clockNow}
              />
            )}
          </section>

          {d && (
            <section className="rule-t pad-x" style={{ padding: "20px 32px", display: "grid", gridTemplateColumns: "minmax(0,200px) minmax(0,1fr)", gap: 28, alignItems: "center" }}>
              <span className="label-strong">WHAT MOVED IT</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", height: 26, fontSize: 12, fontWeight: 600, color: "var(--bg)" }}>
                  <div style={{ width: `${d.news * 100}%`, background: "var(--amber)", display: "flex", alignItems: "center", paddingLeft: 10, overflow: "hidden", whiteSpace: "nowrap" }}>{d.news > 0.08 ? `NEWS · ${pctInt(d.news)}` : ""}</div>
                  <div style={{ width: `${d.onchain * 100}%`, background: "var(--violet)", display: "flex", alignItems: "center", paddingLeft: 10, overflow: "hidden", whiteSpace: "nowrap" }}>{d.onchain > 0.08 ? `ON-CHAIN · ${pctInt(d.onchain)}` : ""}</div>
                  <div style={{ width: `${d.unexplained * 100}%`, background: "var(--rule)", color: "var(--muted)", display: "flex", alignItems: "center", paddingLeft: 8, overflow: "hidden", whiteSpace: "nowrap" }}>{d.unexplained > 0.05 ? `? ${pctInt(d.unexplained)}` : ""}</div>
                </div>
                <div className="muted" style={{ fontSize: 11 }}>{r.scorer?.name ?? "The scorer"} splits the move between headlines and on-chain flow in the same window. Not every move needs the news.</div>
              </div>
            </section>
          )}

          <section className="three rule-t">
            <div className="rule-r">
              <div className="rule-b" style={{ display: "flex", justifyContent: "space-between", padding: "18px 24px" }}>
                <span className="label-strong" style={{ color: "var(--amber)" }}>● HEADLINES</span>
                <span className="muted" style={{ fontSize: 11 }}>odds it caused the move</span>
              </div>
              {heads.length === 0 && <p className="muted" style={{ padding: 24 }}>No headlines about {r.ticker} in this window.</p>}
              {heads.map((h) => {
                const p = h.score?.caused_move ?? null, n = pinNo.get(h.ref)!, first = n === 1 && (p ?? 0) >= 0.3;
                const pc = p == null ? "var(--muted)" : p >= 0.3 ? "var(--amber)" : p < 0.05 ? "var(--muted)" : "var(--ink)";
                return (
                  <div key={h.ref} className="ev rule-b">
                    <div className="pin" style={{ background: first ? "var(--amber)" : "var(--bg)", color: first ? "var(--bg)" : n > 4 ? "var(--muted)" : "var(--ink)", borderColor: first ? "var(--amber)" : n > 4 ? "var(--muted)" : "var(--ink)" }}>{n}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                      <div className="muted" style={{ fontSize: 11, letterSpacing: ".04em" }}>
                        {etWhen(h.time)} · {h.source} · {h.score ? CAT[h.score.category] : "UNSCORED"}
                        {h.score && h.score.caused_move < 0.4 && h.score.caused_move >= 0.15 ? " ?" : ""}
                      </div>
                      <a className="ev-title" href={h.url} target="_blank" rel="noreferrer">{h.title}</a>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }} className="muted">
                        <span>odds</span>
                        <b style={{ color: pc, fontSize: 14 }}>{pctInt(p)}</b>
                      </div>
                      <div className="bar3"><div style={{ width: `${(p ?? 0) * 100}%`, background: pc }} /></div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="rule-r">
              <div className="rule-b" style={{ display: "flex", justifyContent: "space-between", padding: "18px 24px" }}>
                <span className="label-strong" style={{ color: "var(--violet)" }}>■ ON-CHAIN EVENTS</span>
                <span className="muted" style={{ fontSize: 11 }}>odds it caused the move</span>
              </div>
              {!r.tradesAvailable && (
                <div className="rule-b" style={{ padding: "10px 24px", fontSize: 11, lineHeight: 1.5, color: "var(--amber)" }}>
                  {r.mode === "replay" ? "REPLAY: single-trade (whale) rows need a historical indexer. Without one, we show hourly pool volume spikes instead." : "Trade-level data unavailable right now; showing pool-level signals only."}
                </div>
              )}
              {chain.length === 0 && <p className="muted" style={{ padding: 24 }}>No unusual on-chain activity: no whale trades, volume spikes, pool divergence or active memecoin pairs.</p>}
              {chain.map((e, i) => {
                const p = e.score?.caused_move ?? null, first = i === 0 && (p ?? 0) >= 0.3;
                return (
                  <div key={e.id} className="ev rule-b">
                    <div className="sq" style={{ background: first ? "var(--violet)" : "var(--bg)", color: first ? "var(--bg)" : "var(--violet)", borderColor: "var(--violet)" }}>{e.id}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                      <div className="muted" style={{ fontSize: 11, letterSpacing: ".04em" }}>
                        {e.kind === "pool_divergence" || e.kind === "paired_token" ? "NOW / 24H" : etWhen(e.time)} · <span style={{ color: "var(--violet)" }}>{KIND[e.kind]}</span>
                      </div>
                      <div className="ev-title">{e.title}</div>
                      <a href={e.link} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: 11, textDecoration: "none" }}>{e.detail} · {e.linkLabel} ↗</a>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <b className="num" style={{ fontSize: 14, textAlign: "right", color: p == null ? "var(--muted)" : p >= 0.3 ? "var(--violet)" : "var(--ink)" }}>{pctInt(p)}</b>
                      <div className="bar3"><div style={{ width: `${(p ?? 0) * 100}%`, background: "var(--violet)" }} /></div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div className="rule-b" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
                <span className="label-strong">HOW THIN IS IT</span>
                {r.thin ? (
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
                    <span className="display" style={{ fontWeight: 800, fontSize: 56, lineHeight: 0.85, color: r.thin.impactPct > 1 ? "var(--amber)" : "var(--ink)" }}>{r.thin.impactPct.toFixed(2)}%</span>
                    <span className="serif" style={{ fontSize: 17, lineHeight: 1.3 }}>
                      A $1,000 buy moves {r.token} this much ({r.thin.route}). {r.thin.impactPct > 1 ? "Thin: small trades can move it." : "Deep enough for normal trades."}
                    </span>
                  </div>
                ) : (
                  <span className="muted">{r.mode === "replay" ? "Live-only (Jupiter quote); not recorded for replay." : "Jupiter quote unavailable."}</span>
                )}
              </div>
              <div className="rule-b" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
                <span className="label-strong">MEANWHILE, SAME HOURS</span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12 }}>
                  {r.cross.map((c) => (
                    <div key={c.key}>
                      <div className="muted" style={{ fontSize: 11 }}>{c.label}</div>
                      <div className="display num" style={{ fontWeight: 800, fontSize: 30, color: colorOf(c.pct) }}>{c.pct == null ? "n/a" : fmtPct(c.pct, 2)}</div>
                    </div>
                  ))}
                </div>
                <div className="muted" style={{ fontSize: 11 }}>Pyth feeds · context, not a cause.</div>
              </div>
              <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 8, fontSize: 12, lineHeight: 1.55, color: "var(--ink-2)" }}>
                <span className="label-strong" style={{ color: "var(--ink)" }}>HOW THE DESK WORKS</span>
                <span><span style={{ color: "var(--amber)" }}>01</span> Token price vs the last real close (Pyth where our key is entitled)</span>
                <span><span style={{ color: "var(--amber)" }}>02</span> Every headline about the company since the bell</span>
                <span><span style={{ color: "var(--violet)" }}>02b</span> Every on-chain event: whale swaps, volume spikes, pool divergence, memecoins paired against the xStock</span>
                <span><span style={{ color: "var(--amber)" }}>03</span> Claude Haiku scores odds, category, importance</span>
                <span><span style={{ color: "var(--amber)" }}>04</span> The same call writes the bulletin from only those events</span>
              </div>
            </div>
          </section>

          <section className="rule-t">
            <div className="rule-b pad-x" style={{ display: "flex", alignItems: "baseline", gap: 20, padding: "20px 32px", flexWrap: "wrap" }}>
              <span className="label-strong" style={{ color: "var(--violet)" }}>■ ON-CHAIN ACTIVITY</span>
              <span className="muted" style={{ fontSize: 11, marginRight: "auto" }}>every DEX pool for the {r.token} mint · liquidity and volume as of {r.mode === "replay" ? "recording" : "now"}</span>
              <span className="muted" style={{ fontSize: 11 }}>reference move <b style={{ color: colorOf(r.gapPct) }}>{fmtPct(r.gapPct)}</b></span>
            </div>
            <div className="act">
              <div className="rule-r">
                <div className="pools-grid label rule-b" style={{ paddingTop: 10, paddingBottom: 10 }}>
                  <span>POOL</span><span className="hide-m">DEX</span><span>LIQUIDITY</span><span className="hide-m">24H VOLUME SHARE</span><span className="hide-m" style={{ textAlign: "right" }}>24H</span><span style={{ textAlign: "right" }}>VS REF</span>
                </div>
                {r.pools.length === 0 && <p className="muted" style={{ padding: "16px 32px" }}>Pool list unavailable.</p>}
                {r.pools.slice(0, 8).map((p) => {
                  const dev = p.impliedPrice && nowP ? ((p.impliedPrice - nowP) / nowP) * 100 : null;
                  const share = p.volume24hUsd / totalVol;
                  return (
                    <div key={p.address} className="pools-grid rule-b" style={{ fontSize: 13 }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                        <a href={p.url} target="_blank" rel="noreferrer" className="display" style={{ fontWeight: 800, fontSize: 19, letterSpacing: ".02em", color: "var(--ink)", textDecoration: "none" }}>{p.pair}</a>
                        {p.paired && <span className="tag-v">PAIRED TOKEN</span>}
                      </div>
                      <span className="muted hide-m">{p.dex}</span>
                      <span>{fmtBig(p.liquidityUsd)}</span>
                      <div className="hide-m" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 5, background: "var(--rule)" }}><div style={{ height: 5, width: `${share * 100}%`, background: "var(--violet)" }} /></div>
                        <span style={{ width: 34, textAlign: "right" }}>{Math.round(share * 100)}%</span>
                      </div>
                      <span className="hide-m" style={{ textAlign: "right", fontWeight: 600, color: colorOf(p.change24hPct) }}>{p.change24hPct == null ? "—" : fmtPct(p.change24hPct)}</span>
                      <span style={{ textAlign: "right", fontSize: 11, letterSpacing: ".06em", fontWeight: 600, color: dev != null && Math.abs(dev) > 1 ? "var(--violet)" : "var(--muted)" }}>
                        {dev == null ? "—" : Math.abs(dev) <= 1 ? "IN LINE" : `${dev > 0 ? "+" : "−"}${Math.abs(dev).toFixed(1)} PTS OFF`}
                      </span>
                    </div>
                  );
                })}
                <div className="muted pad-x" style={{ padding: "12px 32px", fontSize: 11, lineHeight: 1.5 }}>
                  If only one pool moves while the reference doesn&apos;t, it&apos;s a local anomaly, not a real repricing. Wick Wire labels those POOL ≠ REF.
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div className="rule-b" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <span className="label">SUPPLY · MINT / REDEEM</span>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
                    <span className="display num" style={{ fontWeight: 800, fontSize: 36, lineHeight: 0.85 }}>{r.supply != null ? Math.round(r.supply).toLocaleString("en-US") : "—"}</span>
                    <span style={{ fontSize: 12, lineHeight: 1.5 }}>
                      {r.token} outstanding
                      <br />
                      <span className="muted">change since close: unavailable (no historical snapshot)</span>
                    </span>
                  </div>
                </div>
                <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
                  <span className="label">PAIRED TOKENS (MEMECOINS ETC.)</span>
                  {paired.length === 0 ? (
                    <div style={{ border: "1px dashed var(--rule)", padding: 12, fontSize: 12, lineHeight: 1.5 }}>No unusual pairs. {r.token} trades only against USDC, USDT and SOL.</div>
                  ) : (
                    paired.map((p) => (
                      <div key={p.address} style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                        <span className="display" style={{ fontWeight: 800, fontSize: 24 }}>${p.otherSymbol}</span>
                        <span className="display" style={{ fontWeight: 800, fontSize: 24, color: colorOf(p.otherChange24hPct) }}>{p.otherChange24hPct == null ? "n/a" : fmtPct(p.otherChange24hPct, 0)}</span>
                        <span className="muted" style={{ fontSize: 11 }}>{p.dex} · vs {r.token} · {Math.round((p.volume24hUsd / totalVol) * 100)}% of volume</span>
                      </div>
                    ))
                  )}
                  <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>We only flag tokens actually paired with the xStock in a pool. Look-alike tokens that aren&apos;t paired are ignored rather than guessed.</div>
                </div>
              </div>
            </div>
          </section>
          {r.unavailable.length > 0 && (
            <div className="rule-t muted pad-x" style={{ padding: "12px 32px", fontSize: 11 }}>
              Unavailable this run: {r.unavailable.join(" · ")}. Generated {etLong(Math.floor(r.generatedAt / 1000))}.
            </div>
          )}
        </>
      )}
      <Footer mode={mode} sources={SOURCES_LINE} />
    </div>
  );
}
