// Spike: Finnhub news for NVDA over the replay weekend + GeckoTerminal NVDAx pool candles + ONE Claude Haiku call
// that scores every headline and writes the explanation (structured output).
// Budget: 1 Finnhub call, 2 GeckoTerminal calls, 1 Claude call.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

process.loadEnvFile?.(".env.local");

const MODEL = "claude-haiku-4-5";
const PRICE_IN = 1 / 1e6, PRICE_OUT = 5 / 1e6;
const MINT = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const FRI = Date.parse("2026-09-18T16:00:00-04:00") / 1000;
const SUN = Date.parse("2026-09-20T20:00:00-04:00") / 1000;

async function news() {
  const url = `https://finnhub.io/api/v1/company-news?symbol=NVDA&from=2026-09-18&to=2026-09-21&token=${process.env.FINNHUB_KEY}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`finnhub ${r.status} ${await r.text()}`);
  const all: { headline: string; source: string; datetime: number; url: string; summary: string }[] = await r.json();
  const seen = new Set<string>();
  const inWindow = all
    .filter((n) => n.datetime >= FRI - 3600 && n.datetime <= SUN)
    .filter((n) => {
      const k = n.headline.toLowerCase().trim();
      if (seen.has(k) || seen.has(n.url)) return false;
      seen.add(k).add(n.url);
      return true;
    })
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, 15);
  console.log(`finnhub: ${all.length} items returned, ${inWindow.length} in window after dedupe`);
  return inWindow;
}

async function poolMove() {
  const pools = await (await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${MINT}/pools`)).json();
  const main = pools.data[0];
  const addr = main.attributes.address;
  // Hourly candles, before Mon 00:00 UTC; token=base so price is NVDAx in USD
  const o = await (
    await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${addr}/ohlcv/hour?aggregate=1&before_timestamp=${SUN + 3600}&limit=60&currency=usd&token=${MINT}`)
  ).json();
  const list: number[][] = o.data.attributes.ohlcv_list; // [ts, o, h, l, c, v] newest first
  const at = (ts: number) => list.filter((c) => c[0] <= ts).sort((a, b) => b[0] - a[0])[0];
  const fri = at(FRI - 1), sun = at(SUN);
  console.log(`pool ${main.attributes.name} ${addr}: ${list.length} hourly candles`);
  console.log(`  Fri ~16:00 ET close $${fri?.[4]?.toFixed(2)}  Sun ~20:00 ET close $${sun?.[4]?.toFixed(2)}`);
  return { pool: main.attributes.name as string, fri: fri?.[4], sun: sun?.[4] };
}

const Category = z.enum(["earnings", "guidance", "analyst", "macro", "legal_regulatory", "product", "m_and_a", "sector", "onchain", "other"]);
const Result = z.object({
  events: z.array(z.object({ i: z.number().int(), caused_move: z.number(), category: Category, importance: z.number() })),
  driver: z.object({ news: z.number(), onchain: z.number(), unexplained: z.number() }),
  alert_holders: z.object({ yes: z.boolean(), confidence: z.number() }),
  reason: z.string(),
  explanation: z.string(),
});

async function main() {
  const [items, move] = await Promise.all([news(), poolMove()]);
  const gap = move.fri && move.sun ? ((move.sun / move.fri - 1) * 100).toFixed(2) : "unavailable";
  const events = items.map((n, i) => `[${i}] ${new Date(n.datetime * 1000).toISOString()} ${n.source}: ${n.headline}`).join("\n");
  const prompt = `Ticker NVDA (token NVDAx on Solana). Window: Fri 18 Sep 2026 16:00 ET -> Sun 20 Sep 2026 20:00 ET.
Token move in window: ${gap}% (NVDAx in ${move.pool} pool: $${move.fri?.toFixed(2)} -> $${move.sun?.toFixed(2)}).
On-chain events: none supplied in this test.

Events:
${events || "(no headlines in window)"}`;

  const client = new Anthropic();
  const t0 = Date.now();
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    system: `You score why a tokenized stock moved while the US market was closed. Use ONLY the supplied events and numbers; never add outside facts.
For each event i: caused_move = probability 0-1 that it caused this move (direction and timing must fit); category; importance 0-100.
driver = probabilities (sum to 1) that the move is explained by news, by on-chain activity, or unexplained.
alert_holders = should holders be alerted (true only if |move| >= 2% and a likely cause exists).
reason = one line, <= 18 words. explanation = max 3 short sentences citing only the top 1-3 events and the numbers.
If the top caused_move < 0.4, the explanation must say: "No clear catalyst — likely thin weekend trading or sector/macro drift."`,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: zodOutputFormat(Result) },
  });
  const ms = Date.now() - t0;
  const out = res.parsed_output!;
  const u = res.usage;
  console.log(`\nclaude ${MODEL}: ${ms} ms, in ${u.input_tokens} / out ${u.output_tokens} tokens, $${(u.input_tokens * PRICE_IN + u.output_tokens * PRICE_OUT).toFixed(5)}`);
  console.log("driver", out.driver, "alert", out.alert_holders);
  console.log("reason:", out.reason);
  console.log("explanation:", out.explanation);
  for (const e of [...out.events].sort((a, b) => b.caused_move - a.caused_move).slice(0, 5))
    console.log(`  ${e.caused_move.toFixed(2)} ${e.category.padEnd(16)} imp ${e.importance}  ${items[e.i]?.headline}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
