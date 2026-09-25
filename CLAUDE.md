# CLAUDE.md — "Why It Moved" (Stocklana hackathon)

## What we are building
A web app that explains **why tokenized US stocks on Solana moved while Wall Street was closed** (after-hours, overnight, weekends).

- Wall Street trades ~6.5h/day, 5 days/week. Tokenized stocks (xStocks such as NVDAx, TSLAx) trade 24/7 on Solana.
- ~63% of tokenized-stock volume happens outside US market hours.
- Existing tools show *how much* the token moved vs the last real close. **Nobody explains *why*.** That is our entire differentiator.
- "Why" has **two sources**, and we explain both:
  1. **Off-chain / mainstream**: news and headlines (earnings, analyst calls, macro, legal, etc.).
  2. **On-chain**: things that happened on Solana itself: a whale trade in a thin pool, a volume spike in one pool, a memecoin (or other non-stable token) paired with the xStock dragging it, one pool diverging from the Pyth aggregate price, xStock supply changes (mint/redeem), liquidity being pulled.
  Often the answer is "no news; the move came from one pool / one trade", and only we can say that. This is also our answer to "why does this belong on Solana?".

**One-liner:** "Other tools tell you how much it moved. We tell you why."

**Product name: Wick Wire** ("your bag moved · here's why"). The *wick* is how far the token moved; the *wire* is why (news or on-chain). "Why It Moved" is the pitch phrase.

**UI spec: `docs/DESIGN.md`** (distilled from the claude.ai/design "Wick Wire v2" mockup). It is the source of truth for layout, colors, fonts and components and overrides any looser UI wording below. Mockup numbers are sample: wire every value to the pipeline.

This is an **application only**. We do NOT launch any token, pool, or smart contract. We read data and explain it.

## Hackathon constraints
- Event: Solana Foundation "Stocklana". Submission deadline: **Friday 25 Sep 2026, 4:00 PM ET (1:30 AM IST Sat)**. Target submit by 12:30 AM IST.
- Tracks we enter: **Main track** + **Pyth bounty** ("best use of Pyth market data": Pyth must be central).
- Judges ask: real user + real problem, working end-to-end demo, reason it belongs on Solana, execution quality.
- Submission needs: GitHub link + live demo URL + ~90s video.

## Scope: 8 stocks only
NVDA, TSLA, AAPL, MSFT, AMZN, META, SPY, QQQ (xStocks: NVDAx, TSLAx, AAPLx, MSFTx, AMZNx, METAx, SPYx, QQQx).
Do not expand scope until the core flow is deployed.

## Screens
1. **Board (`/`)**: one card per stock with:
   - last real-market close (Pyth equity feed) and its timestamp
   - live onchain token price (Pyth xStock feed, fallback Jupiter)
   - gap % = (token − last close) / last close, colored up/down
   - market state badge: OPEN / AFTER-HOURS / OVERNIGHT / WEEKEND (compute from US/Eastern time)
   - "thin market" warning if a $1,000 Jupiter quote has price impact > 1%
   - one-line reason (from the explanation pipeline)
   - driver chip: **NEWS** / **ON-CHAIN** / **MIXED** / **NO CLEAR CAUSE** (from the top-scored events)
   - top bar: toggle **Live / Replay (last weekend)**
2. **Stock page (`/stock/[ticker]`)**:
   - 3-line plain-English explanation of the move
   - ranked headlines, each with Jev's **"caused the move" probability**, category chip, importance score
   - **On-chain activity** section:
     - pools table for the xStock mint (DEX, pair, liquidity, volume in window, price change, price vs Pyth deviation %)
     - largest trades in the window (size USD, side, pool, time, wallet short address linked to Solscan)
     - flagged pairs: any pool where the other token is not USDC/USDT/SOL (e.g. a memecoin), with that token's own move
     - supply change since last close (mint/redeem)
     - on-chain events are ranked together with headlines in one list (same `caused_move` / category / importance scoring)
   - cross-asset context row from Pyth: Gold (XAU/USD), Bitcoin (BTC/USD), EUR/USD: change over the same window
   - "thin weekend market" note when relevant
   - footer disclaimer: "Not financial advice. Tokenized stocks are not available to US persons and are restricted in some regions."
3. **Alerts (stretch)**: Telegram bot that pushes "NVDA token −4.1% since Friday close — likely cause: …" when Jev's alert flag = true and |gap| ≥ 2%.
   **UI patterns to borrow (from CoinGecko × Jev demos):**
   - Label chips per headline and per stock (e.g. "Earnings", "Macro", "Analyst"), with a trailing "?" when Jev's confidence is low.
   - A live stats strip in the header: "scored 38 headlines · 8 Jev calls · $0.0004 · p50 290 ms". This proves speed and cost to judges; compute it from real call timings and token usage.
   - A clear REPLAY badge whenever replay data is shown.
4. **Wallet filter (stretch)**: connect Phantom/Solflare, read SPL balances, show only stocks the user holds.

## Pipeline (per ticker, cached 5 minutes)
1. **Prices**: Pyth Hermes `GET https://hermes.pyth.network/v2/updates/price/latest?ids[]=...`
   - Discover feed IDs at runtime/once via `GET https://hermes.pyth.network/v2/price_feeds?query=<SYMBOL>` and store them in `lib/stocks.ts`. Needed: `Equity.US.<SYM>/USD` and `Crypto.<SYM>X/USD` for each stock, plus `Metal.XAU/USD`, `Crypto.BTC/USD`, `FX.EUR/USD`.
   - Always apply `expo` and keep `publish_time`. During closed hours the equity feed stays at its last print: use that as "last close" and show its timestamp.
   - If equity feeds need a Pyth Pro key, read `PYTH_API_KEY` from env; if unavailable, fall back to Pyth Benchmarks or a clearly labeled secondary source.

   **Pyth access facts (verified 25 Sep 2026, supersede the URLs above where they conflict):**
   - Since 26 Aug 2026 every Pyth price call needs `Authorization: Bearer $PYTH_API_KEY` (Hermes, Benchmarks, Pro). Metadata `GET https://pyth.dourolabs.app/v1/symbols` is free and gives lazer id, hermes id, exponent, min_channel, schedules (incl. holidays + pre/post/overnight sessions). Snapshot lives in `lib/feeds.generated.json`.
   - Our key is a **DEMO plan: use the API sparingly.** Batch ids, cache aggressively (≥5 min live, fixtures for replay), never call Pyth per page view, never loop spikes. Demo tokens expire.
   - Entitlement is per feed. Our key currently covers (of what we need): `Equity.US.TSLA/USD` (1435), `Equity.US.QQQ/USD` (1363), `Metal.XAU/USD` (346), `Crypto.BTC/USD` (1), `FX.EUR/USD` (327). **Not** NVDA/AAPL/MSFT/AMZN/META/SPY equity, **no** xStock `…X/USD`, no Ondo `…ON/USD`.
   - One non-entitled id makes the whole request 403 (`Not entitled: feed …`). So: fetch `GET https://pyth.dourolabs.app/v1/symbols?entitled_only=true` (auth) once, cache ~1h, and only request entitled ids. Non-entitled feeds fall back automatically (below). When the key is upgraded the app switches to Pyth with no code change.
   - Endpoints: Hermes latest `https://hermes.pyth.network/v2/updates/price/latest?ids[]=…&parsed=true`; historical point Benchmarks `https://benchmarks.pyth.network/v1/updates/price/{ts}?ids=…&parsed=true` (returns first update ≥ ts → check `publish_time`); **candles** via Pro History UDF `https://pyth.dourolabs.app/v1/fixed_rate@200ms/history?symbol=<sym>&resolution=5|15|60&from=&to=` (decimals, no expo; the old `/v1/shims/tradingview/*` is retired → 404). Pro latest `POST https://pyth-lazer.dourolabs.app/v1/latest_price` with `marketSession` property. Last regular close = close of the candle ending 16:00 ET on the last trading day.
   - Exponents: equities −5, xStocks −8, XAU −3, EUR −5. Hermes/Benchmarks rate limit ~10 req / 10 s per IP.
   - Fallbacks (label the source in the UI, never pretend it is Pyth): xStock live price → Jupiter Price v3; xStock history/candles → GeckoTerminal pool OHLCV of the main USDC pool; last equity close → Finnhub `/quote` (`pc`) for live, and a labeled secondary daily-close source for replay; Pyth on-chain Solana price accounts are **stale** (equity since 26 Aug) — do not use.
2. **Onchain liquidity**: Jupiter (`https://lite-api.jup.ag`). Price v3 for fallback price; swap quote USDC→xStock for $1,000 to get price impact. Find xStock mint addresses via Jupiter token search (`/tokens/v2/search?query=NVDAx`) or the xStocks docs: **verify mints, never guess**.
2b. **On-chain signals** (`lib/onchain.ts`): turn Solana activity into typed **events** that are scored alongside headlines. No keys required.
   - Pools per xStock mint: GeckoTerminal `GET https://api.geckoterminal.com/api/v2/networks/solana/tokens/{mint}/pools` (fallback DexScreener `GET https://api.dexscreener.com/token-pairs/v1/solana/{mint}`). Keep pool address, DEX, base/quote tokens, reserve (liquidity) USD, volume, price change.
   - Hourly per-pool OHLCV for the window: GeckoTerminal `/networks/solana/pools/{pool}/ohlcv/hour?before_timestamp=...` (also works historically → replay).
   - Recent trades per pool: GeckoTerminal `/networks/solana/pools/{pool}/trades` (live only, recent window). Historical trades for replay only if an indexer key is available (`HELIUS_API_KEY`, optional); otherwise replay shows hourly volume spikes and says trade-level data is unavailable.
   - Token supply: Solana RPC `getTokenSupply(mint)` now vs at last close (for replay, only if obtainable from real data; otherwise unavailable).
   - Event types generated (each with real numbers, source, timestamp): `whale_trade` (single trade ≥ max($50k, 10% of window volume)), `volume_spike` (hour volume ≥ 3× window median), `pool_divergence` (pool price vs Pyth xStock price > 1%), `paired_token` (pool whose other token is not USDC/USDT/SOL; include that token's own % move), `supply_change` (|Δsupply| ≥ 1%), `liquidity_change` (pool reserve change ≥ 25%).
   - Only flag memecoins that are **actually paired** with the xStock in a pool. Never link a token to a stock by name/theme alone.
   - Respect GeckoTerminal free rate limit (~30 req/min): top 3 pools by liquidity per ticker, cache 5 min.
3. **News**: Finnhub `GET https://finnhub.io/api/v1/company-news?symbol=NVDA&from=YYYY-MM-DD&to=YYYY-MM-DD&token=FINNHUB_KEY` covering the window since the last close. Fallback: Google News RSS for "<Company> stock". Dedupe by URL/title; keep top 15 most recent.
4. **Scoring (Jev)**: one call per ticker with the move context + all events (headlines **and** on-chain events). Typed questions per event:
   - `caused_move`: probability 0–1
   - `category`: one of `earnings | guidance | analyst | macro | legal_regulatory | product | m_and_a | sector | onchain | other` (on-chain events keep their event type, e.g. `whale_trade`, as a sub-label)
   - `importance`: 0–100
   - ticker-level `alert_holders`: yes/no with confidence
   - ticker-level `driver`: `choice` over `news | onchain | unexplained` → the probabilities are the "WHAT MOVED IT" split (NEWS x% · ON-CHAIN y% · ? z%) and the board split bar / flag. Label it as Jev's estimate.
   Implement behind an interface `Scorer` in `lib/scorer/`. `fallback.ts` implements the SAME typed JSON output using Claude (`claude-haiku-4-5-20251001`) with a strict JSON schema. Choose via `SCORER=jev|claude` env. Validate all outputs with zod.

   **Jev API facts (verify against docs.typesafe.ai / its llms.txt before coding):**
   - Jev does NOT generate text. You send a `state` (text or JSON) plus a map of named typed `questions`; you get one typed answer per question with probabilities/confidence.
   - Native endpoint: `POST https://api.typesafe.ai/v1/systemone`, bearer `TYPESAFE_API_KEY`, body `{ model, state, questions }`. Model alias `jev-latest` (currently `jev-1.13.0`).
   - Question kinds: `choice` (criteria = 1–255 named options, returns a probability per option), `score` (ordered criteria array of 2–10 levels, returns expected score), `noul` (yes/no probability; criteria optional).
   - All questions in one request are scored in parallel against the same state → put ALL events for a ticker in one request (one `noul` "caused_move_<i>" + one `choice` "category_<i>" + one `score` "importance_<i>" per event, plus ticker-level `noul` "alert_holders"). Cap at 15 headlines + 8 on-chain events.
   - Limits: ~32k tokens state + longest question, 1,200 req/min. Price $0.042 / M input tokens, output free.
   - Access without the waitlist: **Vercel AI Gateway** model `typesafe-ai/jev` (easiest since we deploy on Vercel), Cloudflare Workers AI `typesafe/jev`, OpenRouter `typesafe/jev-1.13`, NanoGPT `POST /api/v1/decisions` with `typesafe/jev-1.13`. Implement the native TypeSafe shape first; add ONE gateway adapter only if we lack a TypeSafe key.
   - Reference implementation: CoinGecko's open demos combining their API with Jev: `git clone https://github.com/cg-growth/content` → `coingecko-jev/`. Read it for request/response handling and UI patterns. Check its license; if we copy code, credit it in the README.
   **Decision (25 Sep): Jev key unavailable → `SCORER=claude` is the only scorer we ship.** Keep the `Scorer` interface (so Jev can be dropped in later), but do not build `jev.ts` now. All UI copy/stats say "Claude Haiku", never "Jev".
   **Cost rules (user cannot afford high LLM spend):** model `claude-haiku-4-5` only ($1/M in, $5/M out). ONE call per ticker returns scores + driver split + alert + reason + explanation together (structured output via `client.messages.parse` + `zodOutputFormat`), ~1.7k in / ~350 out ≈ $0.0034. Cache live results 30 min and skip the call when the input hash (headlines + events + rounded gap) is unchanged; hard cap `LLM_MAX_CALLS_PER_DAY` (default 150) → show cached/"scoring paused" instead of calling. Replay is generated once by the script and read from the fixture (zero LLM calls at demo time). Finnhub is also a free key: one company-news call per ticker per cache window.
5. **Explanation**: Claude (`claude-haiku-4-5-20251001`) writes max 3 short sentences using only the top 1–3 scored events (headlines and/or on-chain events) + numbers. Must not invent facts. Say whether the driver looks like news, on-chain activity, or both (e.g. "No major news; most of the move came from a $180k buy in the NVDAx/USDC pool at 02:14 ET, while Pyth's aggregate price moved only +0.9%"). If top `caused_move` < 0.4, say "No clear catalyst — likely thin weekend trading or sector/macro drift" and cite the cross-asset context.
5b. **Chart data** (stock page "candle by candle"): OHLC candles for the xStock feed from Pyth Benchmarks TradingView shim `GET https://benchmarks.pyth.network/v1/shims/tradingview/history?symbol=<Crypto.NVDAX/USD>&resolution=5|15|60&from=<ts>&to=<ts>` from last close → now. Volume bars from GeckoTerminal pool OHLCV (sum of the mint's top pools); if unavailable, omit volume. Pins: headlines (numbered) and on-chain events (lettered) at their timestamps.
5c. **The Wire** (board rail): all scored events across the 8 tickers, newest first.
6. **Cache** results per ticker for 5 minutes (Next.js `unstable_cache` or in-memory map). Never call LLMs on every page load.

## Replay mode (critical for the demo)
We record the demo on a Friday while the US market is OPEN, so a live weekend move is impossible. Replay mode shows a real past weekend.
- `scripts/build-replay.ts` pulls, for last weekend (Fri 18 Sep 2026 4:00 PM ET → Mon 21 Sep 2026 9:30 AM ET):
  - Friday close + a Sunday-evening token price per stock (Pyth Benchmarks: `https://benchmarks.pyth.network/v1/updates/price/{unix_ts}?ids=...`)
  - Finnhub news for 18–21 Sep
  - on-chain: pools per mint + hourly OHLCV over the window (GeckoTerminal); trade-level whale events only if `HELIUS_API_KEY` is set, else marked unavailable
  - runs the same scoring + explanation pipeline
  - writes `data/replay/2026-09-20.json`
- The UI toggle reads that fixture. Label it clearly "Replay: weekend of 19–20 Sep 2026".
- If any data is unavailable, show it as unavailable. **Never fabricate prices or headlines.**

## Stack
- Next.js 15 (App Router) + TypeScript + Tailwind. Deploy on Vercel.
- zod for all external data. No database; cache + JSON fixtures only.
- `@solana/wallet-adapter` only if the wallet filter stretch is reached.
- Env vars: `PYTH_API_KEY` (optional), `FINNHUB_KEY`, `TYPESAFE_API_KEY` (or `AI_GATEWAY_API_KEY` for Vercel AI Gateway), `ANTHROPIC_API_KEY`, `SCORER`, `SOLANA_RPC_URL` (optional, default public mainnet RPC), `HELIUS_API_KEY` (optional, historical trades for replay), `TELEGRAM_BOT_TOKEN` (stretch), `TELEGRAM_CHAT_ID` (stretch). Provide `.env.example`.

## Suggested structure
```
app/
  page.tsx                      # board
  stock/[ticker]/page.tsx       # detail
  api/board/route.ts            # all 8 cards (live or replay)
  api/stock/[ticker]/route.ts   # detail payload
  api/alerts/route.ts           # stretch: cron-triggered telegram push
lib/
  stocks.ts          # tickers, names, Pyth feed ids, xStock mints
  market-hours.ts    # OPEN / AFTER-HOURS / OVERNIGHT / WEEKEND in America/New_York
  pyth.ts            # latest + benchmarks, expo handling
  jupiter.ts         # price fallback + $1k quote price impact
  onchain.ts         # pools, OHLCV, trades, supply → typed on-chain events
  news.ts            # finnhub + rss fallback, dedupe
  scorer/types.ts    # Scorer interface + zod schemas
  scorer/jev.ts
  scorer/fallback.ts
  explain.ts         # 3-sentence explanation
  pipeline.ts        # prices → news → score → explain → cache
  replay.ts          # load fixture
scripts/build-replay.ts
data/replay/
```

## Rules
- Plan first, then build in the phases in the kickoff prompt. Commit after each phase.
- Deploy to Vercel early (end of Phase 2) and keep it deployed.
- Real data only. If a source fails, show a visible "unavailable" state; do not fake it.
- Show confidence numbers in the UI; the product's honesty is part of the pitch.
- The app never signs or sends transactions. Read-only.
- Keep the UI clean and fast: follow `docs/DESIGN.md` (dark "Night Desk", Big Shoulders / Newsreader / Plex Mono, large gap numbers), readable on mobile.
- If behind schedule, cut in this order: Telegram alerts → wallet filter → cross-asset row → whale-trade detail (keep pools/volume/divergence) → Jupiter depth warning. Never cut: board, stock page, Jev/Claude scoring, explanation, replay mode, on-chain pools + volume/divergence signals.
- On-chain claims must come from real data with a source link (pool address / tx signature on Solscan). Never infer a memecoin–stock link that is not an actual pool pair.
