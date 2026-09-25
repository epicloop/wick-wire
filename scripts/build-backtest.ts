// Paper backtest for the replay weekend: the Sunday-night signal vs the real token price at Monday 21 Sep 09:30 ET.
//   npx tsx scripts/build-backtest.ts      (reads + updates data/replay/2026-09-20.json; no LLM calls)
import { readFileSync, writeFileSync } from "node:fs";
import { poolCandles } from "../lib/onchain";
import { REPLAY_FILE, type ReplayFixture } from "../lib/replay";
import { backtestRow } from "../lib/signal";

const MON_OPEN = Date.parse("2026-09-21T09:30:00-04:00") / 1000;

async function main() {
  const fx = JSON.parse(readFileSync(REPLAY_FILE, "utf8")) as ReplayFixture;
  const rows = [];
  for (const r of fx.board.reports) {
    const main = r.pools.find((p) => !p.paired);
    let exit: number | null = null;
    let src = "unavailable";
    if (main) {
      const cs = await poolCandles(main.address, r.mint, 15, MON_OPEN - 3600, MON_OPEN + 3600).catch(() => []);
      const c = cs.find((c) => c.t === MON_OPEN) ?? cs.find((c) => c.t > MON_OPEN);
      if (c) {
        exit = c.o;
        src = `${r.token} ${main.dex} pool, 15-min candle open ${new Date(c.t * 1000).toISOString().slice(11, 16)} UTC`;
      }
    }
    const row = backtestRow(r, exit, src);
    rows.push(row);
    console.log(
      `${row.ticker.padEnd(5)} ${row.signal.padEnd(8)} ${String(row.side ?? "").padEnd(4)} entry ${row.entry?.toFixed(2)} exit ${row.exit?.toFixed(2)} ` +
        `gapClosed ${row.gapClosedPct?.toFixed(0)}% net ${row.netPct?.toFixed(2) ?? "—"}  (${row.why})`,
    );
  }
  fx.backtest = { exitLabel: "Mon 21 Sep 9:30 AM ET (NYSE open)", rows, generatedAt: Date.now() };
  writeFileSync(REPLAY_FILE, JSON.stringify(fx));
  console.log("updated", REPLAY_FILE);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
