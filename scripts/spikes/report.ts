// Run one live report end-to-end: npx tsx scripts/spikes/report.ts NVDA
process.loadEnvFile?.(".env.local");
import { buildLive as liveReport } from "../../lib/pipeline";
import { stats } from "../../lib/stats";
const t = (process.argv[2] ?? "NVDA") as "NVDA";
(async () => {
const r = await liveReport(t);
const { pools, headlines, onchain, explanation, ...rest } = r;
console.log(JSON.stringify(rest, null, 1).slice(0, 2500));
console.log("explanation:", explanation.map((s) => (s.ref ? `[${s.ref}]` : "") + s.text).join(""));
for (const h of headlines.slice(0, 6)) console.log("  N", h.score?.caused_move?.toFixed(2), h.score?.category, h.title.slice(0, 90));
for (const e of onchain) console.log("  ", e.id, e.kind, e.score?.caused_move?.toFixed(2), e.title);
for (const p of pools.slice(0, 6)) console.log("  pool", p.pair, p.dex, Math.round(p.liquidityUsd), p.impliedPrice?.toFixed(2), p.paired ? "PAIRED" : "");
console.log("pythCalls", stats.pythCalls);
})();
