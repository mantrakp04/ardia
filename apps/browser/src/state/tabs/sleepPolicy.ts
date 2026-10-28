import type { SystemState } from "../../platform/performance";

type MemoryPressure = SystemState["memoryPressure"];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const SLEEP_POLICY = {
  protectedRecent: 4,
  sleepAfterMs: 4 * HOUR,
  recentSleepAfterMs: 8 * HOUR,
  warningSleepAfterMs: HOUR,
  criticalSleepAfterMs: 10 * MINUTE,
  profileIdleMs: 5 * MINUTE,
  perSweep: 6,
  busyCpu: 10,
  freezeAfterMs: MINUTE,
  maxAwakeStepMs: 5 * MINUTE,
};

export type SleepPolicy = typeof SLEEP_POLICY;

export function sleepAfterMs(policy: SleepPolicy, pressure: MemoryPressure, recent: boolean): number {
  if (pressure === "critical") return policy.criticalSleepAfterMs;
  if (recent) return policy.recentSleepAfterMs;
  return pressure === "warning" ? policy.warningSleepAfterMs : policy.sleepAfterMs;
}

export function awakeClock(now: () => number, maxStepMs: number) {
  let total = 0;
  let last = now();
  return {
    read() {
      const t = now();
      total += Math.min(Math.max(0, t - last), maxStepMs);
      last = t;
      return total;
    },
    advance(ms: number) {
      total += Math.max(0, ms);
      return total;
    },
  };
}
