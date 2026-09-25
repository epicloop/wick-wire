// Spike: verified xStock mints (Jupiter), $1k USDC quote price impact, GeckoTerminal pools, token supply.
// Writes verified mints into lib/feeds.generated.json under stocks.<T>.mint
import { readFileSync, writeFileSync } from "node:fs";

const JUP = "https://lite-api.jup.ag";
const GT = "https://api.geckoterminal.com/api/v2";
const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TICKERS = ["NVDA", "TSLA", "AAPL", "MSFT", "AMZN", "META", "SPY", "QQQ"];

type JupToken = { id: string; symbol: string; name: string; decimals: number; tags?: string[]; isVerified?: boolean; usdPrice?: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function findMint(t: string) {
  const res: JupToken[] = await (await fetch(`${JUP}/tokens/v2/search?query=${t}x`)).json();
  // Only accept the token Jupiter tags as an official xStock, with the exact symbol.
  const hits = res.filter((x) => x.symbol === `${t}x` && x.tags?.includes("xstocks") && x.isVerified);
  if (hits.length !== 1) throw new Error(`${t}x: expected 1 verified xstocks token, got ${hits.length}`);
  return hits[0];
}

async function quote(mint: string) {
  const url = `${JUP}/swap/v1/quote?inputMint=${USDC}&outputMint=${mint}&amount=1000000000&slippageBps=100`;
  const q = await (await fetch(url)).json();
  return { priceImpactPct: Number(q.priceImpactPct) * 100, route: q.routePlan?.map((r: { swapInfo: { label: string } }) => r.swapInfo.label).join(" > ") };
}

async function pools(mint: string) {
  const j = await (await fetch(`${GT}/networks/solana/tokens/${mint}/pools?page=1`)).json();
  return (j.data ?? []).map((p: { attributes: Record<string, unknown>; relationships: { dex: { data: { id: string } } } }) => ({
    name: p.attributes.name,
    address: p.attributes.address,
    dex: p.relationships.dex.data.id,
    reserveUsd: Math.round(Number(p.attributes.reserve_in_usd)),
    vol24h: Math.round(Number((p.attributes.volume_usd as Record<string, string>).h24)),
  }));
}

async function supply(mint: string) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenSupply", params: [mint] }),
  });
  return (await r.json()).result?.value?.uiAmount as number | undefined;
}

async function main() {
  const feeds = JSON.parse(readFileSync("lib/feeds.generated.json", "utf8"));
  for (const t of TICKERS) {
    try {
      const tok = await findMint(t);
      const [q, ps, s] = await Promise.all([quote(tok.id), pools(tok.id), supply(tok.id)]);
      feeds.stocks[t].mint = { address: tok.id, decimals: tok.decimals, name: tok.name, source: "jupiter tokens/v2 (verified, tag xstocks)" };
      console.log(`\n${t}x ${tok.id} jupPrice=${tok.usdPrice?.toFixed(2)} supply=${s} $1k impact=${q.priceImpactPct.toFixed(3)}% via ${q.route}`);
      for (const p of ps.slice(0, 6)) console.log(`   ${p.dex.padEnd(18)} ${String(p.name).padEnd(22)} liq $${p.reserveUsd} vol24h $${p.vol24h}`);
      console.log(`   pools: ${ps.length}`);
    } catch (e) {
      console.log(`\n${t}: FAILED ${e}`);
    }
    await sleep(2500); // GeckoTerminal free tier ~30 req/min
  }
  writeFileSync("lib/feeds.generated.json", JSON.stringify(feeds, null, 2));
}

main();
