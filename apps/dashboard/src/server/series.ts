import { stepMs, type Step, type Window } from "../lib/range";
import { num } from "./clickhouse";

export type Series = { key: string; label: string; values: number[] };

export type WindowInfo = {
  range: Window["range"];
  step: Step;
  start: number;
  end: number;
  prevStart: number | null;
  buckets: number[];
  zone: string;
};

export const windowInfo = (w: Window): WindowInfo => ({
  range: w.range,
  step: w.step,
  start: w.start,
  end: w.end,
  prevStart: w.prevStart,
  buckets: w.buckets,
  zone: w.zone,
});

export function fill(buckets: number[], rows: unknown[][], column: number): number[] {
  const byBucket = new Map<number, number>();
  for (const row of rows) byBucket.set(num(row[0]), num(row[column]));
  return buckets.map((b) => byBucket.get(b) ?? 0);
}

const DAY = 86_400_000;

export const floorDay = (ms: number) => Math.floor(ms / DAY) * DAY;

export function dayBuckets(start: number, end: number): number[] {
  const out: number[] = [];
  for (let t = floorDay(start); t <= end; t += DAY) out.push(t);
  return out;
}

export function compareBuckets(w: Window): number[] {
  if (w.prevStart === null) return w.buckets;
  const size = stepMs(w.step);
  const first = Math.floor(w.prevStart / size) * size;
  const out: number[] = [];
  for (let t = first; t <= w.end; t += size) out.push(t);
  return out;
}

export type Kpi = {
  key: string;
  label: string;
  value: number | null;
  previous: number | null;
  display?: string;
  format: "count" | "percent";
  goodWhenUp: boolean;
  spark: number[];
  sparkStep: Step;
  hint: string;
};

export const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
