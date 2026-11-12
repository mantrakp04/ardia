import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireAllowed } from "./api";
import { parseRange, type Step } from "./range";
import { parseZone } from "./zone";

export const TREND_FAMILIES = ["launch", "switch", "memory", "omnibox"] as const;
export type TrendFamily = (typeof TREND_FAMILIES)[number];

export type TrendSeries = { count: number[]; p50: (number | null)[]; p90: (number | null)[]; p99: (number | null)[] };

export type PerformanceTrend = { family: TrendFamily; step: Step; buckets: number[]; zone: string; groups: Record<string, TrendSeries> };

export const getPerformanceTrend = createServerFn({ method: "POST" })
  .middleware([requireAllowed])
  .validator((input: { family: string; range?: string; zone?: string }) => {
    if (!TREND_FAMILIES.includes(input?.family as TrendFamily)) throw new Error("Unknown trend");
    return { family: input.family as TrendFamily, range: parseRange(input.range), zone: parseZone(input.zone) };
  })
  .handler(async ({ data }): Promise<PerformanceTrend> => {
    const { performanceTrend } = await import("../server/sections/performance-trends");
    return performanceTrend(data.range, data.family, getRequest().signal, data.zone);
  });
