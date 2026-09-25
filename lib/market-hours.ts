// NYSE session state in America/New_York, driven by Pyth's own schedule string for the equity feed
// (includes early closes and holidays), e.g.
// "America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;0907/C,1126/C,1127/0930-1300,..."
import { STOCKS } from "./stocks";

export type MarketState = "OPEN" | "AFTER-HOURS" | "OVERNIGHT" | "WEEKEND";

const TZ = "America/New_York";
const SCHEDULE = STOCKS.SPY.equity.schedule;

type Parts = { y: number; m: number; d: number; wd: number; hh: number; mm: number };

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});
const WD = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 } as const;

export function etParts(ms: number): Parts {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, wd: WD[p.weekday as keyof typeof WD], hh: +p.hour, mm: +p.minute };
}

/** UTC ms for a wall-clock time in New York. */
export function etToUtc(y: number, m: number, d: number, hh: number, mm: number): number {
  let guess = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) {
    const p = etParts(guess);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    guess += Date.UTC(y, m - 1, d, hh, mm) - asUtc;
  }
  return guess;
}

const [, weekly = "", overrides = ""] = SCHEDULE.split(";");
const WEEK = weekly.split(",");
const OVERRIDE = new Map(
  overrides
    .split(",")
    .filter(Boolean)
    .map((o) => o.split("/") as [string, string]),
);

function parseRanges(spec: string): [number, number][] {
  if (!spec || spec === "C") return [];
  if (spec === "O") return [[0, 2400]];
  return spec.split("&").map((r) => r.split("-").map(Number) as [number, number]);
}

/** Regular sessions [openMs, closeMs] for the ET calendar date containing `ms`. */
function sessionsOn(ms: number): [number, number][] {
  const p = etParts(ms);
  const key = String(p.m).padStart(2, "0") + String(p.d).padStart(2, "0");
  const spec = OVERRIDE.get(key) ?? WEEK[p.wd];
  return parseRanges(spec).map(([a, b]) => [
    etToUtc(p.y, p.m, p.d, Math.floor(a / 100), a % 100),
    etToUtc(p.y, p.m, p.d, Math.floor(b / 100), b % 100),
  ]);
}

const DAY = 86_400_000;

export function lastClose(now = Date.now()): number {
  for (let i = 0; i < 12; i++) {
    const ends = sessionsOn(now - i * DAY).map(([, c]) => c).filter((c) => c <= now);
    if (ends.length) return Math.max(...ends);
  }
  throw new Error("no close found in 12 days");
}

export function nextOpen(now = Date.now()): number {
  for (let i = 0; i < 12; i++) {
    const starts = sessionsOn(now + i * DAY).map(([o]) => o).filter((o) => o > now);
    if (starts.length) return Math.min(...starts);
  }
  throw new Error("no open found in 12 days");
}

export function isOpen(now = Date.now()): boolean {
  return sessionsOn(now).some(([o, c]) => now >= o && now < c);
}

export function marketState(now = Date.now()): MarketState {
  if (isOpen(now)) return "OPEN";
  const close = lastClose(now);
  const open = nextOpen(now);
  if (open - close > 20 * 3_600_000) {
    // Close → open spans more than one night: weekend or holiday.
    if (open - close > 30 * 3_600_000) return "WEEKEND";
  }
  const hh = etParts(now).hh;
  if (now - close < 4 * 3_600_000 && hh >= 16 && hh < 20) return "AFTER-HOURS";
  return "OVERNIGHT";
}

export function marketClock(now = Date.now()) {
  const state = marketState(now);
  const close = state === "OPEN" ? null : lastClose(now);
  return { state, now, lastClose: close ?? lastClose(now), nextOpen: state === "OPEN" ? null : nextOpen(now) };
}

export function formatEt(ms: number, opts: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", minute: "2-digit", ...opts }).format(ms);
}
