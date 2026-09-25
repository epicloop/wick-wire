import { z } from "zod";

export const CATEGORIES = ["earnings", "guidance", "analyst", "macro", "legal_regulatory", "product", "m_and_a", "sector", "onchain", "other"] as const;
export const Category = z.enum(CATEGORIES);
export type Category = z.infer<typeof Category>;

/** One thing that might explain the move: a headline (ref "N1"…) or an on-chain event (ref "A"…). */
export type ScoreInputEvent = { ref: string; kind: "news" | "onchain"; time: number; text: string; source: string };

export type ScoreInput = {
  ticker: string;
  token: string;
  windowLabel: string; // e.g. "Fri 18 Sep 16:00 ET → Sun 20 Sep 20:00 ET"
  movePct: number | null;
  refLabel: string; // what the move is measured against
  fromPrice: number | null;
  toPrice: number | null;
  thin: boolean;
  cross: string; // "Gold +0.4%, BTC −1.8%, EUR/USD −0.1%" or "unavailable"
  events: ScoreInputEvent[];
};

export const ScoreOutput = z.object({
  scores: z.array(
    z.object({
      ref: z.string(),
      caused_move: z.number().describe("probability 0-1 that this event caused the move"),
      category: Category,
      importance: z.number().describe("0-100"),
    }),
  ),
  driver: z.object({ news: z.number(), onchain: z.number(), unexplained: z.number() }).describe("probabilities summing to 1"),
  alert_holders: z.object({ yes: z.boolean(), confidence: z.number() }),
  reason: z.string().describe("one line, max 18 words"),
  explanation: z
    .array(z.object({ text: z.string(), ref: z.string().nullable() }))
    .describe("the explanation as ordered text segments; a segment that paraphrases an event carries its ref, others null"),
});
export type ScoreOutput = z.infer<typeof ScoreOutput>;

export type ScoreMeta = { model: string; latencyMs: number; inputTokens: number; outputTokens: number; costUsd: number };

export interface Scorer {
  name: string;
  score(input: ScoreInput): Promise<{ output: ScoreOutput; meta: ScoreMeta }>;
}

/** Clamp + normalise model output so the UI can trust it. */
export function sanitize(out: ScoreOutput, refs: Set<string>): ScoreOutput {
  const c01 = (x: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
  const d = { news: c01(out.driver.news), onchain: c01(out.driver.onchain), unexplained: c01(out.driver.unexplained) };
  const sum = d.news + d.onchain + d.unexplained || 1;
  return {
    ...out,
    scores: out.scores
      .filter((s) => refs.has(s.ref))
      .map((s) => ({ ...s, caused_move: c01(s.caused_move), importance: Math.round(Math.min(100, Math.max(0, s.importance))) })),
    driver: { news: d.news / sum, onchain: d.onchain / sum, unexplained: d.unexplained / sum },
    alert_holders: { yes: out.alert_holders.yes, confidence: c01(out.alert_holders.confidence) },
    explanation: out.explanation.map((s) => ({ text: s.text, ref: s.ref && refs.has(s.ref) ? s.ref : null })),
  };
}
