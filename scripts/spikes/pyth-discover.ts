// Discover Pyth Hermes feed ids for the 8 stocks + cross-assets and write lib/stocks.generated.json
import { writeFileSync, mkdirSync } from "node:fs";

const HERMES = "https://hermes.pyth.network";
const TICKERS = ["NVDA", "TSLA", "AAPL", "MSFT", "AMZN", "META", "SPY", "QQQ"];
const CROSS = { XAU: "Metal.XAU/USD", BTC: "Crypto.BTC/USD", EURUSD: "FX.EUR/USD" };

type Feed = { id: string; attributes: { symbol: string; schedule?: string } };

async function search(query: string): Promise<Feed[]> {
  const res = await fetch(`${HERMES}/v2/price_feeds?query=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`${query}: HTTP ${res.status}`);
  return res.json();
}

async function exact(query: string, symbol: string) {
  const hit = (await search(query)).find((f) => f.attributes.symbol === symbol);
  if (!hit) throw new Error(`feed not found: ${symbol}`);
  return { id: "0x" + hit.id, symbol, schedule: hit.attributes.schedule ?? null };
}

async function main() {
  const out: Record<string, unknown> = { discoveredAt: new Date().toISOString(), stocks: {}, cross: {} };
  for (const t of TICKERS) {
    const [equity, xstock] = await Promise.all([
      exact(t, `Equity.US.${t}/USD`),
      exact(`${t}X`, `Crypto.${t}X/USD`).catch((e) => ({ error: String(e) })),
    ]);
    (out.stocks as Record<string, unknown>)[t] = { equity, xstock };
    console.log(t, equity.id.slice(0, 14), "xstock:", "id" in xstock ? xstock.id.slice(0, 14) : xstock.error);
  }
  for (const [k, sym] of Object.entries(CROSS)) {
    const f = await exact(sym.split(".")[1], sym);
    (out.cross as Record<string, unknown>)[k] = f;
    console.log(k, f.id.slice(0, 14));
  }
  mkdirSync("lib", { recursive: true });
  writeFileSync("lib/feeds.generated.json", JSON.stringify(out, null, 2));
  console.log("wrote lib/feeds.generated.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
