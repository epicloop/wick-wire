import { claudeScorer } from "./claude";
import type { Scorer } from "./types";

// SCORER=jev is reserved for the Jev adapter (no key available during the hackathon); Claude is the default.
export function getScorer(): Scorer {
  return claudeScorer;
}
