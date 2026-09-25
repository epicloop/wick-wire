// Claude Haiku scorer: ONE call per ticker returns per-event scores, the news/on-chain split, the alert flag,
// the one-line reason and the explanation. Cheapest current model; structured output validated by zod.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ScoreOutput, sanitize, type ScoreInput, type Scorer } from "./types";

const MODEL = "claude-haiku-4-5";
const USD_PER_IN = 1 / 1e6;
const USD_PER_OUT = 5 / 1e6;

const SYSTEM = `You explain why a tokenized US stock (an xStock on Solana) moved while the US market was closed.
Use ONLY the events and numbers supplied. Never add outside facts, prices, dates or causes.

Return exactly one entry in "scores" for EVERY event ref listed, no more, no fewer.
Score every event (by its ref):
- caused_move: probability 0-1 that it caused THIS move. Direction and timing must fit: an event after the move, or pointing the other way, scores low. Generic commentary scores low.
- category: news → earnings | guidance | analyst | macro | legal_regulatory | product | m_and_a | sector | other; on-chain events → onchain.
- importance: 0-100 for a holder of this stock.
driver: probabilities (sum 1) that the move is explained by news, by on-chain activity, or unexplained. It must agree with the scores: if no event has caused_move >= 0.4, "unexplained" should be the largest share.
alert_holders: yes only if |move| >= 2% and a likely cause exists.
reason: one plain line, max 18 words, no refs, no hedging words like "likely" repeated.
explanation: at most 3 short sentences and at most 60 words in total, as ordered segments; each segment's text includes its own spacing and punctuation so that concatenating the segments reads correctly. Put each paraphrase of an event in its own segment with that event's ref; all other text has ref null. Write times as e.g. "Saturday 11:40 AM ET". Never print refs or brackets in the text.
If the highest caused_move is below 0.4, the explanation must contain: "No clear catalyst — likely thin <session> trading or sector/macro drift." (use the session given) and mention the cross-asset context if given.
If the move is below 0.5% in size, say it is a small move.`;

function prompt(i: ScoreInput) {
  const move = i.movePct == null ? "unavailable" : `${i.movePct >= 0 ? "+" : ""}${i.movePct.toFixed(2)}%`;
  const lines = i.events.map((e) => {
    const t = new Date(e.time * 1000).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });
    return `${e.ref} | ${e.kind} | ${t} ET | ${e.source} | ${e.text}`;
  });
  return `Ticker ${i.ticker} (token ${i.token}). Session: ${i.session}. Window: ${i.windowLabel}.
Move: ${move} (${i.refLabel}${i.fromPrice && i.toPrice ? `: $${i.fromPrice.toFixed(2)} → $${i.toPrice.toFixed(2)}` : ""}).
Thin market (a $1,000 buy moves price > 1%): ${i.thin ? "yes" : "no"}.
Cross-asset over the same window: ${i.cross}.

Events (ref | kind | time | source | text):
${lines.join("\n") || "(none)"}`;
}

export const claudeScorer: Scorer = {
  name: "Claude Haiku 4.5",
  async score(input) {
    const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });
    const t0 = Date.now();
    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: 2500,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt(input) }],
      output_config: { format: zodOutputFormat(ScoreOutput) },
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error(`scorer: no parsed output (${res.stop_reason})`);
    const u = res.usage;
    return {
      output: sanitize(res.parsed_output, new Set(input.events.map((e) => e.ref))),
      meta: {
        model: MODEL,
        latencyMs: Date.now() - t0,
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        costUsd: u.input_tokens * USD_PER_IN + u.output_tokens * USD_PER_OUT,
      },
    };
  },
};
