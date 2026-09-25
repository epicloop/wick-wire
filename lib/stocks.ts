import feeds from "./feeds.generated.json";

export const TICKERS = ["NVDA", "TSLA", "AAPL", "MSFT", "AMZN", "META", "SPY", "QQQ"] as const;
export type Ticker = (typeof TICKERS)[number];

export type FeedMeta = {
  symbol: string;
  lazerId: number;
  hermesId: string;
  exponent: number;
  minChannel: string;
  schedule: string;
};

export type Stock = {
  ticker: Ticker;
  token: string; // e.g. NVDAx
  name: string; // company / fund name
  query: string; // news fallback query
  keywords: RegExp | null; // headline relevance filter (null = market-wide ETF: keep all)
  mint: string; // verified xStock mint (Jupiter tokens/v2, verified + xstocks tag)
  decimals: number;
  equity: FeedMeta;
  xstock: FeedMeta;
};

const KEYWORDS: Record<Ticker, RegExp | null> = {
  NVDA: /nvidia|nvda|jensen huang|geforce|blackwell|cuda/i,
  TSLA: /tesla|tsla|elon musk|musk|robotaxi|cybertruck/i,
  AAPL: /apple|aapl|iphone|tim cook|ipad|mac\b|app store/i,
  MSFT: /microsoft|msft|azure|satya nadella|copilot|openai|xbox/i,
  AMZN: /amazon|amzn|aws|andy jassy|prime/i,
  META: /\bmeta\b|meta platforms|facebook|instagram|whatsapp|zuckerberg|llama/i,
  SPY: /s&p 500|s&p500|stock market|stocks|wall street|dow jones|\bdow\b|nasdaq|\bfed\b|federal reserve|treasur|inflation|futures|tariff|jobs report/i,
  QQQ: /nasdaq|tech stocks|stock market|stocks|wall street|\bfed\b|federal reserve|treasur|inflation|futures|chip|semiconductor|magnificent seven/i,
};

const QUERY: Record<Ticker, string> = {
  NVDA: "Nvidia stock",
  TSLA: "Tesla stock",
  AAPL: "Apple stock",
  MSFT: "Microsoft stock",
  AMZN: "Amazon stock",
  META: "Meta Platforms stock",
  SPY: "S&P 500 stocks",
  QQQ: "Nasdaq stocks",
};

const NAMES: Record<Ticker, string> = {
  NVDA: "NVIDIA Corp.",
  TSLA: "Tesla Inc.",
  AAPL: "Apple Inc.",
  MSFT: "Microsoft Corp.",
  AMZN: "Amazon.com Inc.",
  META: "Meta Platforms",
  SPY: "S&P 500 ETF",
  QQQ: "Nasdaq-100 ETF",
};

type Raw = { mint: { address: string; decimals: number }; equity: FeedMeta; xstock: FeedMeta };
const raw = feeds.stocks as unknown as Record<Ticker, Raw>;

export const STOCKS: Record<Ticker, Stock> = Object.fromEntries(
  TICKERS.map((t) => [
    t,
    {
      ticker: t,
      token: `${t}x`,
      name: NAMES[t],
      query: QUERY[t],
      keywords: KEYWORDS[t],
      mint: raw[t].mint.address,
      decimals: raw[t].mint.decimals,
      equity: raw[t].equity,
      xstock: raw[t].xstock,
    },
  ]),
) as Record<Ticker, Stock>;

export const CROSS = feeds.cross as unknown as Record<"XAU" | "BTC" | "EURUSD", FeedMeta>;
export const CROSS_LABEL = { XAU: "GOLD", BTC: "BTC", EURUSD: "EUR/USD" } as const;

export const STABLE_OR_SOL = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "So11111111111111111111111111111111111111112", // wSOL
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", // PYUSD
]);

export function isTicker(t: string): t is Ticker {
  return (TICKERS as readonly string[]).includes(t);
}
