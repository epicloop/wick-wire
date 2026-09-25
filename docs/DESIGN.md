> **Update:** the home page now follows **Wick Wire v3** (claude.ai/design file `Wick Wire v3.dc.html`): IBM Plex Sans + JetBrains Mono, amber #E8B04B / violet #A493FF / signal teal #6FD0C8 on #0B0C0A; sections 01 pick a stock · 02 what happened (how much · why · will it stick + paper trade) · 03 did the signals work (replay backtest, toasts) · 04 your paper trades. The v2 "Night Desk" below lives on at `/desk` and `/stock/[ticker]`.

# Wick Wire — UI spec (from claude.ai/design "Wick Wire v2.dc.html", Direction 2 "The Night Desk")

Source: https://claude.ai/design/p/dc26462a-7f32-44c0-955e-59b7e810dc04?file=Wick+Wire+v2.dc.html
All numbers in the mockup are SAMPLE. Every value in the app must come from the pipeline; missing → "unavailable".

Concept line: "Wall Street is closed, but the tokens keep trading. The **wick** shows how far each token moved;
the **wire** says why, from the news or from on-chain flow."

## Tokens
| token | value | use |
|---|---|---|
| bg | `#0E1014` | page |
| surface | `#151820` | hover rows, explanation panel, "future" chart zone |
| rule | `#262B36` | all 1px borders, empty bar tracks |
| ink | `#EDEAE2` | primary text |
| ink-2 | `#B9BDC7` | secondary text |
| muted | `#8A90A0` | labels, meta |
| amber | `#FFB547` | NEWS, Friday close marker, state badge, links (hover `#FFD08A`) |
| violet | `#A493FF` | ON-CHAIN |
| up | `#5FE0B0` | positive gap |
| down | `#FF6B57` | negative gap, logo candle |
Selection: amber bg / bg text. No border radius anywhere (except headline pin circles). Square, rule-lined, newspaper/trading-pit feel.

Fonts (Google): **Big Shoulders Display** 600/800/900 (tickers, prices, big %), **Newsreader** 400/500 + italic (explanations, headlines, hero), **IBM Plex Mono** 400/500/600 (everything else, data). `font-variant-numeric: tabular-nums` on all numbers. Labels: 11–12px, letter-spacing .08–.14em, uppercase.

## Header (both pages), 64px, bottom rule
- Logo: 14×30 svg — vertical ink line + down-colored candle body — then "WICK WIRE" Big Shoulders 900 28px.
- Tagline "your bag moved · here's why" (muted 12px). Detail page: "← ALL MOVERS" link instead.
- Market-state badge: amber 1px border, 7px amber square, label + countdown `HH:MM:SS` to next NYSE open.
  Labels: OPEN → "NYSE OPEN · TOKENS TRACK THE TAPE" (no countdown); AFTER-HOURS → "AFTER-HOURS · NEXT OPEN IN"; OVERNIGHT → "OVERNIGHT · OPENS IN"; WEEKEND → "NYSE CLOSED · OPENS IN".
- LIVE | REPLAY segmented control (active = ink bg / bg text; inactive = muted text).
- When replay: full-width amber strip under header: "REPLAY · RECORDED WEEKEND OF 19–20 SEP 2026 · … TIMES IN ET".

## Board `/` (desktop grid: main + 400px right rail "THE WIRE")
- Hero: Newsreader 52px "Wall Street is asleep." + italic amber "{n} tokens moved anyway." (n = |gap| ≥ 0.5%). When OPEN, copy must change honestly (e.g. "Wall Street is open." / "tokens are tracking the tape").
- Stats line under hero (muted 13px): "{h} headlines + {e} on-chain events read · {j} Jev calls · ${cost} · p50 {ms} ms" — REAL counters only.
- SORT segmented: BIGGEST GAP | MOST LIKELY (explained confidence) | A–Z.
- Table header: `# | TOKEN | WEEKEND WICK | GAP VS FRI | WHY · NEWS + ON-CHAIN` (cols 32/150/230/170/1fr, gap 28, padding 20×32).
- Row (link to `/stock/[t]`, hover surface):
  - rank `01`
  - ticker Big Shoulders 800 38px; under it "NVDAx · NVIDIA" muted 11px
  - **wick svg 230×36**: muted range line, body rect from Fri close to now (up/down color), amber vertical tick at Fri close; below: "| fri $181.20" … "now $173.76"
  - gap % Big Shoulders 800 72px, up/down color, `+4.2%` / `−4.1%` (true minus sign)
  - why cell: driver flag chip (NEWS = amber fill, ON-CHAIN = violet fill, NEWS + ON-CHAIN = ink outline, UNEXPLAINED = muted/rule outline) + category text muted + optional amber "· THIN WEEKEND MARKET"; reason sentence Newsreader 21px; split bar 120×9 (amber news % then violet on-chain %) + "news 62% · on-chain 29%"; source line muted 11px.
- Flag rule: explained = news + chain; `< 40` → UNEXPLAINED; news ≥ 40 && chain ≥ 25 → NEWS + ON-CHAIN; else larger of the two.
- **THE WIRE** rail: "headlines + on-chain events Jev scored"; rows: day/time (colored by kind) | ticker (Big Shoulders 17) + title (Newsreader 16) + "KIND · source" | probability % (colored amber/violet when ≥ 50, muted < 20). Sorted newest first across all tickers.
- Footer: disclaimer left; right "Prices: Pyth · Pools: GeckoTerminal, DexScreener · Supply: Solana RPC · Scoring: Jev" (+ " · Replay data" when replay; never "Sample data").

Mobile (390): 56px header with logo + single mode toggle button (min-height 44); amber strip with state + countdown; hero 34px; stacked cards: ticker 32 + "fri $x → $y" | gap 52px; full-width wick svg 22px high; flag + category + 70px split bar; reason Newsreader 17px. Wire rail hidden on mobile.

## Stock detail `/stock/[ticker]`
1. Top split (1fr | 520px):
   - left: ticker Big Shoulders 900 120px + "NVDAx on Solana / NVIDIA Corp."; gap % 170px colored; "FRI CLOSE · 4:00 PM ET $181.20" (amber label) and "NVDAx NOW · PYTH $173.76".
   - right (surface bg): driver chip + categories; explanation Newsreader 27px where the phrase from a headline is underlined amber and the phrase from an on-chain event underlined violet; hedging sentence italic ink-2. Bottom: 16px split bar + "NEWS 62% · ON-CHAIN 29% · UNEXPLAINED 9% · from pins 1–3 · A–B".
2. **THE WEEKEND, CANDLE BY CANDLE**: "15-min candles from Pyth · ● headlines · ■ on-chain events"; 5M/15M/1H toggle. SVG 1376×430: candles (up/down), volume bars at bottom (opacity .35), amber dashed Fri-close line labelled "FRI CLOSE 181.20", down-dotted last-price line with filled price tag at right, y-axis hi/lo labels, x labels "FRI 4:00 PM · BELL", "SAT", "SUN", "NOW". Headline pins = numbered circles at top (1 filled amber, others outlined) with dotted drop lines to the candle; on-chain pins = lettered squares (A filled violet) near bottom with violet dotted lines. Right "future" zone (surface) until next open: "NYSE OPENS / Mon 9:30 AM ET / countdown / gap either closes or holds".
3. **WHAT MOVED IT**: 26px stacked bar NEWS · x% (amber) | ON-CHAIN · y% (violet) | ? z% (rule). Caption: "Jev splits the move between headlines and on-chain flow in the same window. Not every move needs the news."
4. Three columns:
   - **● HEADLINES** (amber): pin circle n | "SAT 11:40 · Reuters · LEGAL" + title link (Newsreader 18, hover amber) | "odds" + % + 3px bar.
   - **■ ON-CHAIN EVENTS** (violet): square id | "SAT 12:05 · WHALE" + title + "tx short · Solscan ↗" | % + bar. In replay, amber note: "REPLAY: single-trade rows need a historical indexer. Without one, we show hourly pool volume spikes instead." (only if true).
   - right: **HOW THIN IS IT** (Jupiter $1k price impact, big %, sentence) · **MEANWHILE, SAME HOURS** Gold / BTC / EUR/USD % colored + "Context, not a cause." · **HOW THE DESK WORKS** 01 Pyth price vs Friday's real close / 02 Every headline since the bell / 02b Every on-chain event / 03 Jev scores odds, category, importance / 04 A second model writes the bulletin.
5. **■ ON-CHAIN ACTIVITY** "every pool for the NVDAx mint · Fri 4:00 PM → now" + "Pyth reference move −4.1%".
   - pools table: POOL (pair Big Shoulders 19, MEMECOIN PAIR violet tag) | DEX | LIQUIDITY FRI → NOW (+Δ, down color if ≤ −20%) | WEEKEND VOLUME share bar | POOL MOVE | VS PYTH ("IN LINE" muted or "+3.8 PTS OFF" violet). Note: "If only one pool moves while Pyth doesn't, it's a local anomaly… labeled POOL ≠ PYTH."
   - right 400px: SUPPLY · MINT / REDEEM (big %, "a → b NVDAx", "net redeems · not a driver"); PAIRED MEMECOINS (symbol, % move, "DEX · vs NVDAx" + honesty note) or empty state "No unusual pairs. NVDAx trades only against USDC, USDT and SOL."
6. Footer as board.

Mobile detail: not drawn in the mockup — stack all sections single-column, chart full width with horizontal scroll disabled (viewBox scales).
