// Real counters for the header stats strip ("38 headlines + 214 on-chain events read · 8 Claude calls · $0.03 · p50 290 ms").
export type Stats = {
  headlines: number;
  onchainEvents: number;
  llmCalls: number;
  llmCostUsd: number;
  llmLatencyMs: number[];
  pythCalls: number;
  since: number;
};

const g = globalThis as unknown as { __wwStats?: Stats; __wwLlmDay?: { day: string; n: number } };

export const stats: Stats = (g.__wwStats ??= {
  headlines: 0,
  onchainEvents: 0,
  llmCalls: 0,
  llmCostUsd: 0,
  llmLatencyMs: [],
  pythCalls: 0,
  since: Date.now(),
});

export function p50(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Daily hard cap on LLM calls (per instance). Returns false when the budget is spent. */
export function takeLlmBudget(): boolean {
  const cap = Number(process.env.LLM_MAX_CALLS_PER_DAY ?? 150);
  const day = new Date().toISOString().slice(0, 10);
  if (!g.__wwLlmDay || g.__wwLlmDay.day !== day) g.__wwLlmDay = { day, n: 0 };
  if (g.__wwLlmDay.n >= cap) return false;
  g.__wwLlmDay.n++;
  return true;
}
