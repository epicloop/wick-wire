# Stocklana submission: Wick Wire

## Links
- Live demo: https://wick-wire.vercel.app
- Replay (real weekend 19–20 Sep 2026): https://wick-wire.vercel.app/?mode=replay
- GitHub: _(add repo URL)_
- Video (~90 s): _(add link)_

## Project name
Wick Wire

## One-liner (≤ 140 chars)
Your xStock moved while Wall Street slept. Wick Wire tells you why: news or on-chain flow, scored, with Pyth prices.

## Short description
Tokenized US stocks trade 24/7 on Solana, but the NYSE only trades 6.5 hours a day. When NVDAx is down 3% on a Sunday, every tool shows the gap and none explains it. Wick Wire measures each xStock against its last real close, reads every headline and every on-chain event since the bell (whale trades, volume spikes, pools drifting from the reference, memecoins paired against the xStock), and scores what actually caused the move. The result is a three-sentence bulletin, a news / on-chain / unexplained split, and a candle chart pinned with the events. It's honest by design: sources are labelled, confidence is shown, and "unavailable" beats a guess.

## Problem
xStock holders are mostly outside the US and mostly trade when the US market is closed. Off-hours moves are frequent and sometimes large, but the "why" is scattered across news sites, DEX screeners and Solscan, or doesn't exist at all (thin liquidity). Holders can't tell a real repricing from one wallet in a thin pool.

## Solution
One screen per stock: the gap vs the real close, what moved it (news vs on-chain vs unexplained), and the evidence ranked by the odds each item caused the move. The board shows all 8 at once plus "The Wire", a scored feed of every headline and on-chain event.

## Why Solana
The problem exists because xStocks trade 24/7 on Solana, and half the answer lives on Solana: DEX pools per mint, whale swaps, memecoins launched against xStocks, token supply. Wick Wire reads them all directly (DexScreener, GeckoTerminal, Jupiter, Solana RPC).

## Pyth usage (bounty)
- **Equity vs token:** the last regular-session close from Pyth Pro History (`Equity.US.TSLA/USD`, `Equity.US.QQQ/USD`), compared to the xStock's 24/7 price.
- **Market clock:** Pyth symbols metadata (sessions, holidays, early closes) drives OPEN / AFTER-HOURS / OVERNIGHT / WEEKEND and the countdown to the next open.
- **Cross-asset context:** gold, BTC and EUR/USD over the same hours from Hermes (live) and Benchmarks (historical).
- **Entitlement-aware client:** checks which feeds the key may read, batches only those, and falls back (labelled) for the rest. A full Pyth Pro key switches every xStock and equity price to Pyth with no code change.

## Autonomous scanner
The live page watches by itself: prices every 20 s, headlines and on-chain events every minute. New headlines, on-chain events and signal changes pop up without a refresh, and a FADE signal triggers an automatic paper trade marked to the live price. Paper only.

## Gap signals (paper only)
Wick Wire also turns the "why" into a paper signal per stock: **FADE** (gap ≥ 1%, mostly on-chain or unexplained, enough Jupiter depth: expect it to close at the open), **RESPECT** (news explains it), or **NO TRADE**. Live, it shows the real $1,000 Jupiter quote and price impact it would use. It never trades or signs anything. Replay example (1 weekend, 8 stocks): no FADE setups; the two RESPECT calls (MSFT, SPY) kept widening into Monday's open; fading every gap blindly would have lost money on 8 of 8 stocks after fees. One weekend is an example, not evidence of an edge. Not financial advice.

## Tech
Next.js 15 on Vercel · TypeScript · zod · Pyth (Pro History, Hermes, Benchmarks, symbols) · Jupiter · DexScreener · GeckoTerminal · Solana RPC · Finnhub / Google News · Claude Haiku 4.5 (one structured call per ticker, ~$0.004).

## What's live vs replay
- Live: real-time data, cached 30 min.
- Replay: a real past weekend recorded once from historical data (Pyth, Yahoo Finance for closes our Pyth key isn't entitled to, GeckoTerminal, Google News), clearly badged REPLAY.

## Open-source components
Next.js, zod, @anthropic-ai/sdk. Fonts: Big Shoulders, Newsreader, IBM Plex Mono (Google Fonts). No copied third-party app code.

---

## 90-second demo checklist

Before recording: open https://wick-wire.vercel.app once and let the live board warm (about 1 minute), then open `/?mode=replay` in a second tab. Screen at 1440 px wide, browser zoom 100%.

| t | Show | Say |
|---|---|---|
| 0–10 s | Home (Live): market line + pulsing SCANNER status | "Wall Street trades 6.5 hours a day. Tokenized stocks on Solana trade 24/7. When they move off-hours, nobody tells you why. Wick Wire does." |
| 10–25 s | Switch to **REPLAY 19–20 SEP**, tiles | "This is a real recorded weekend, 18–20 September. Eight xStocks, each measured against its real Friday close." Point at the biggest gap and its flag chip. |
| 25–35 s | Click a tile → the three cards (how much · why · will it stick) | "Every headline and every on-chain event, scored by the odds it caused the move." |
| 35–60 s | "Show full story and trading pools" → "Open the full desk" (candles + pins) | Read the bulletin (underlines: amber = news, violet = on-chain). Point at the WHAT MOVED IT split, then the candle chart with pins 1–4 and A–C. |
| 60–72 s | Scroll to ON-CHAIN ACTIVITY | "Every pool for the verified mint. Here's a memecoin actually paired against the xStock. We only flag real pairs, never look-alikes." |
| 72–80 s | Section 03 → click **▶ Replay the trades** (toasts) | "It also tells you whether to trust the gap. That weekend: no fades, both RESPECT calls kept widening, and fading everything blindly would have lost on 8 of 8. Paper only, not advice." |
| 80–85 s | Cross-asset row + footer sources | "Pyth gives us the real equity close, the market clock and gold, BTC and EUR/USD for context." |
| 85–90 s | Back to board, LIVE | "Other tools tell you how much it moved. Wick Wire tells you why." |

## Future work
- Opt-in execution: the user signs each FADE trade in Phantom/Solflare via Jupiter (the app never holds keys), with position limits.
- Full Pyth Pro entitlement: every equity close and xStock price from Pyth, and Pyth candles on the chart.
- Historical trade indexer (Helius) for whale rows in replay; supply snapshots for mint/redeem deltas.
- Multi-weekend backtest before any claim of an edge.
- Telegram / push alerts when a holder's token gaps ≥ 2% with a likely cause.
