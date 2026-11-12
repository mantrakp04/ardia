export const RANGES = ["24h", "7d", "30d", "90d", "all"] as const;
export type RangeKey = (typeof RANGES)[number];

export const RANGE_LABEL: Record<RangeKey, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  all: "All time",
};

export const DATA_START_MS = Date.UTC(2026, 8, 29);

export function parseRange(value: unknown): RangeKey {
  return RANGES.includes(value as RangeKey) ? (value as RangeKey) : "7d";
}

import { addDays, startOfDay, startOfHour, UTC } from "./zone.ts";

export type Step = "hour" | "day";

export type Window = {
  range: RangeKey;
  step: Step;
  start: number;
  end: number;
  prevStart: number | null;
  buckets: number[];
  zone: string;
};

const HOUR = 3_600_000;
const DAY = 86_400_000;

const QUANTUM = 5 * 60_000;

export function windowFor(range: RangeKey, zone = UTC, at = Date.now()): Window {
  const now = Math.ceil(at / QUANTUM) * QUANTUM;
  const buckets: number[] = [];
  if (range === "24h") {
    const start = startOfHour(now, zone) - 23 * HOUR;
    for (let t = start; t <= now; t += HOUR) buckets.push(t);
    return { range, step: "hour", start, end: now, prevStart: start - (now - start), buckets, zone };
  }
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const start = range === "all" ? startOfDay(DATA_START_MS, zone) : addDays(startOfDay(now, zone), -(days - 1), zone);
  for (let t = start; t <= now; t = addDays(t, 1, zone)) buckets.push(t);
  return { range, step: "day", start, end: now, prevStart: range === "all" ? null : start - (now - start), buckets, zone };
}

export const stepMs = (step: Step) => (step === "hour" ? HOUR : DAY);
