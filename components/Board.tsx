"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { boardFrom } from "@/lib/board";
import { TICKERS } from "@/lib/stocks";
import type { BoardPayload, TickerReport } from "@/lib/types";
import { FlagChip, Footer, Header, SOURCES_LINE, SplitBar, Wick, colorOf, etDay, etTime, fmtPct, fmtUsd, pctInt, useMode } from "./ui";

type Sort = "move" | "conf" | "az";

export default function Board() {
  const [mode, setMode] = useMode();
  const [data, setData] = useState<BoardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("move");

  const [failed, setFailed] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    setFailed([]);
    const getJson = async <T,>(url: string): Promise<T> => {
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      return j as T;
    };
    if (mode === "replay") {
      getJson<BoardPayload>("/api/board?mode=replay")
        .then((j) => alive && setData(j))
        .catch((e) => alive && setError(e.message));
    } else {
      // Live: one request per ticker so rows appear as soon as each is ready.
      const got: TickerReport[] = [];
      getJson<BoardPayload["market"]>("/api/market")
        .then((market) => {
          if (!alive) return;
          setData(boardFrom([], "live", market, null));
          for (const t of TICKERS)
            getJson<TickerReport>(`/api/stock/${t}`)
              .then((r) => {
                if (!alive) return;
                got.push(r);
                setData(boardFrom([...got], "live", market, null));
              })
              .catch(() => alive && setFailed((f) => [...f, t]));
        })
        .catch((e) => alive && setError(e.message));
    }
    return () => {
      alive = false;
    };
  }, [mode]);

  const rows = useMemo(() => {
    const rs = [...(data?.reports ?? [])];
    const conf = (r: TickerReport) => (r.driver ? r.driver.news + r.driver.onchain : -1);
    if (sort === "move") rs.sort((a, b) => Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0));
    if (sort === "conf") rs.sort((a, b) => conf(b) - conf(a));
    if (sort === "az") rs.sort((a, b) => a.ticker.localeCompare(b.ticker));
    return rs;
  }, [data, sort]);

  const frozenAt = mode === "replay" && data ? data.reports[0]?.window.to * 1000 : null;
  const open = data?.market.state === "OPEN";
  const moved = rows.filter((r) => Math.abs(r.gapPct ?? 0) >= 0.5).length;
  const s = data?.stats;

  return (
    <div className="shell">
      <Header mode={mode} setMode={setMode} market={data?.market ?? null} frozenAt={frozenAt} />
      <div className="board">
        <main className="rule-r">
          <section className="hero rule-b">
            <div style={{ flex: 1 }}>
              <h1>
                {open ? "Wall Street is open." : "Wall Street is asleep."}
                <br />
                <i>
                  {!data || data.reports.length === 0
                    ? "Reading the wire…"
                    : open
                      ? `${moved} token${moved === 1 ? "" : "s"} trading away from the tape.`
                      : `${moved} token${moved === 1 ? "" : "s"} moved anyway.`}
                </i>
              </h1>
              <div className="muted num" style={{ fontSize: 13, marginTop: 14 }}>
                {s && data && data.reports.length > 0
                  ? `${s.headlines} headlines + ${s.onchainEvents} on-chain events read · ${s.llmCalls} ${s.scorer} calls · $${s.llmCostUsd.toFixed(4)} · p50 ${s.p50Ms ?? "—"} ms`
                  : mode === "live"
                    ? "Pulling Pyth, Jupiter, DexScreener, GeckoTerminal and Finnhub… the first load of the day can take ~40 s, then it's cached."
                    : "Loading the recorded weekend…"}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
              <span className="label">SORT</span>
              <div className="seg">
                <button aria-pressed={sort === "move"} onClick={() => setSort("move")}>
                  BIGGEST GAP
                </button>
                <button aria-pressed={sort === "conf"} onClick={() => setSort("conf")}>
                  MOST EXPLAINED
                </button>
                <button aria-pressed={sort === "az"} onClick={() => setSort("az")}>
                  A–Z
                </button>
              </div>
            </div>
          </section>

          <div className="cols label rule-b">
            <span>#</span>
            <span>TOKEN</span>
            <span>{open ? "SESSION WICK" : "OFF-HOURS WICK"}</span>
            <span>{open ? "GAP VS NYSE" : "GAP VS CLOSE"}</span>
            <span>
              WHY · <span style={{ color: "var(--amber)" }}>NEWS</span> + <span style={{ color: "var(--violet)" }}>ON-CHAIN</span>
            </span>
          </div>

          {error && (
            <div className="pad-x" style={{ padding: "28px 32px" }}>
              <div className="label" style={{ color: "var(--down)" }}>
                UNAVAILABLE
              </div>
              <p className="serif" style={{ fontSize: 20 }}>
                The {mode} board could not be built right now ({error}). Nothing is shown rather than guessing.
              </p>
            </div>
          )}
          {rows.map((r, i) => (
            <Row key={r.ticker} r={r} rank={i + 1} mode={mode} />
          ))}
          {failed.map((t) => (
            <div key={t} className="row rule-b">
              <div className="rank muted">—</div>
              <div className="tkr">{t}</div>
              <div className="muted" style={{ gridColumn: "span 3" }}>
                Unavailable right now: the data sources for {t} did not respond. Not shown rather than guessed.
              </div>
            </div>
          ))}
          {!error &&
            Array.from({ length: Math.max(0, 8 - rows.length - failed.length) }, (_, i) => (
              <div key={i} className="skeleton rule-b" style={{ height: 112, opacity: 0.6 }} />
            ))}
        </main>

        <aside className="rail">
          <div className="rule-b" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px" }}>
            <span className="label-strong">THE WIRE</span>
            <span className="muted" style={{ fontSize: 11 }}>
              headlines + on-chain events, scored
            </span>
          </div>
          {(!data || data.reports.length < 8 - failed.length) && !error && Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton rule-b" style={{ height: 76, opacity: 0.5 }} />)}
          {data?.wire.length === 0 && (
            <p className="muted" style={{ padding: 24 }}>
              Nothing on the wire in this window.
            </p>
          )}
          {data?.wire.map((w, i) => {
            const c = w.kind === "NEWS" ? "var(--amber)" : "var(--violet)";
            const pc = w.p == null ? "var(--muted)" : w.p >= 0.5 ? c : w.p < 0.2 ? "var(--muted)" : "var(--ink)";
            return (
              <a key={i} className="wire-row rule-b" href={w.url} target="_blank" rel="noreferrer">
                <div style={{ fontSize: 11, color: c, lineHeight: 1.5 }} className="num">
                  {etDay(w.time)}
                  <br />
                  {etTime(w.time)}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                  <div className="display" style={{ fontWeight: 800, fontSize: 17, letterSpacing: ".03em" }}>
                    {w.ticker}
                  </div>
                  <div className="serif" style={{ fontSize: 16, lineHeight: 1.3 }}>
                    {w.title}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    <span style={{ color: c, fontWeight: 600 }}>{w.kind}</span> · {w.source}
                  </div>
                </div>
                <div className="num" style={{ fontSize: 13, fontWeight: 600, textAlign: "right", color: pc }}>
                  {pctInt(w.p)}
                </div>
              </a>
            );
          })}
        </aside>
      </div>
      <Footer mode={mode} sources={SOURCES_LINE} />
    </div>
  );
}

function Row({ r, rank, mode }: { r: TickerReport; rank: number; mode: string }) {
  const ref = r.reference?.price ?? null, now = r.tokenPrice?.price ?? null;
  const thin = r.thin && r.thin.impactPct > 1;
  const href = `/stock/${r.ticker}${mode === "replay" ? "?mode=replay" : ""}`;
  const gap = <span style={{ color: colorOf(r.gapPct) }}>{fmtPct(r.gapPct)}</span>;
  return (
    <Link href={href} className="row rule-b">
      <div className="rank muted num" style={{ fontSize: 13 }}>
        {String(rank).padStart(2, "0")}
      </div>
      <div className="mobile-top" style={{ display: "none", alignItems: "flex-end", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div className="tkr" style={{ fontSize: 32 }}>
            {r.ticker}
          </div>
          <div className="muted num" style={{ fontSize: 11, marginTop: 4 }}>
            ref {fmtUsd(ref)} → {fmtUsd(now)}
          </div>
        </div>
        <div className="gap" style={{ fontSize: 52 }}>
          {gap}
        </div>
      </div>
      <div className="tkrcell" style={{ minWidth: 0 }}>
        <div className="tkr hide-mobile">{r.ticker}</div>
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          {r.token} · {r.name.replace(/ (Corp\.|Inc\.|Platforms)$/, "")}
        </div>
      </div>
      <div className="wickcell" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {r.wick && ref && now ? (
          <Wick lo={r.wick.lo} hi={r.wick.hi} from={ref} to={now} />
        ) : (
          <div className="muted" style={{ fontSize: 11 }}>
            range unavailable
          </div>
        )}
        <div className="muted num" style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
          <span>
            <span style={{ color: "var(--amber)" }}>|</span> {r.reference?.source === "pyth" ? "close" : "ref"} {fmtUsd(ref)}
          </span>
          <span>now {fmtUsd(now)}</span>
        </div>
      </div>
      <div className="gapcell gap">{gap}</div>
      <div className="mobile-wick" style={{ display: "none" }}>
        {r.wick && ref && now && <Wick lo={r.wick.lo} hi={r.wick.hi} from={ref} to={now} height={22} fluid />}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, letterSpacing: ".08em", flexWrap: "wrap" }}>
          <FlagChip flag={r.flag} />
          <span className="muted">{r.categoryLabel}</span>
          {thin && <span style={{ color: "var(--amber)" }}>· THIN MARKET</span>}
        </div>
        <div className="reason">{r.reason ?? <span className="muted">Explanation unavailable — {r.unavailable.at(-1) ?? "scoring failed"}.</span>}</div>
        {r.driver && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px 10px", flexWrap: "wrap", minWidth: 0 }}>
            <SplitBar news={r.driver.news} chain={r.driver.onchain} />
            <span className="num" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
              <span style={{ color: "var(--amber)" }}>news {pctInt(r.driver.news)}</span> · <span style={{ color: "var(--violet)" }}>on-chain {pctInt(r.driver.onchain)}</span>
            </span>
            <span className="muted" style={{ fontSize: 11, flexBasis: "100%" }}>
              {[r.reference?.label, r.tokenPrice?.label].filter(Boolean).join(" · ")}
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}
