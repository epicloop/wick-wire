// Spike: Pyth latest (Hermes) + historical (Benchmarks) for all 8 stocks' equity & xStock feeds + cross-assets.
import { readFileSync } from "node:fs";

process.loadEnvFile?.(".env.local");
const KEY = process.env.PYTH_API_KEY;
if (!KEY) throw new Error("PYTH_API_KEY missing");
const H = { Authorization: `Bearer ${KEY}` };

const feeds = JSON.parse(readFileSync("lib/feeds.generated.json", "utf8"));
type P = { id: string; price: { price: string; conf: string; expo: number; publish_time: number } };

const rows: [string, string][] = [];
for (const [t, s] of Object.entries<any>(feeds.stocks)) rows.push([`${t}x`, s.xstock.id]); // equity feeds: not entitled on demo plan (403)
for (const [k, f] of Object.entries<any>(feeds.cross)) rows.push([k, f.id]);
const label = new Map(rows.map(([l, id]) => [id.replace(/^0x/, ""), l]));

function print(tag: string, parsed: P[]) {
  console.log(`\n== ${tag}`);
  for (const p of parsed) {
    const v = Number(p.price.price) * 10 ** p.price.expo;
    const age = (Date.now() / 1000 - p.price.publish_time) / 3600;
    console.log(`${(label.get(p.id) ?? p.id).padEnd(12)} ${v.toFixed(3).padStart(12)}  ${new Date(p.price.publish_time * 1000).toISOString()}  (${age.toFixed(1)}h old)`);
  }
}

async function main() {
  const qs = rows.map(([, id]) => `ids[]=${id}`).join("&");
  const latest = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?parsed=true&${qs}`, { headers: H });
  if (!latest.ok) throw new Error(`latest ${latest.status} ${await latest.text()}`);
  print("latest", (await latest.json()).parsed);

  const ET = (d: string) => Date.parse(d) / 1000; // ISO with offset
  for (const [tag, ts] of [
    ["Fri 18 Sep 16:00 ET", ET("2026-09-18T16:00:00-04:00")],
    ["Sun 20 Sep 20:00 ET", ET("2026-09-20T20:00:00-04:00")],
  ] as const) {
    const bq = rows.map(([, id]) => `ids=${id}`).join("&");
    const r = await fetch(`https://benchmarks.pyth.network/v1/updates/price/${ts}?parsed=true&${bq}`, { headers: H });
    if (!r.ok) {
      console.log(`\n== ${tag}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      continue;
    }
    print(tag, (await r.json()).parsed);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
