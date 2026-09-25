// Replay fixture: a real past weekend recorded by scripts/build-replay.ts (Pyth, GeckoTerminal, Finnhub, Claude).
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BoardPayload, ChartPayload } from "./types";

export const REPLAY_FILE = "data/replay/2026-09-20.json";
export const REPLAY_LABEL = "Replay: weekend of 19–20 Sep 2026";

export type ReplayFixture = { board: BoardPayload; charts: Record<string, Partial<Record<"5" | "15" | "60", ChartPayload>>> };

let memo: Promise<ReplayFixture | null> | null = null;

export function loadReplay(): Promise<ReplayFixture | null> {
  memo ??= readFile(path.join(process.cwd(), REPLAY_FILE), "utf8")
    .then((s) => JSON.parse(s) as ReplayFixture)
    .catch(() => null);
  return memo;
}
