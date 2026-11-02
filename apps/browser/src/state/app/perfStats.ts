export type Counter = Record<string, number>;

export const now = () => performance.now();
export const bump = (c: Counter, key: string, by = 1) => void (c[key] = (c[key] ?? 0) + by);

export function fresh() {
  return {
    since: now(),
    commits: 0,
    commitTimes: [] as number[],
    commitTaskLog: [] as string[],
    renders: {} as Counter,
    hooks: {} as Counter,
    mounts: {} as Counter,
    hostUpdates: 0,
    walkMs: 0,
    storeUpdates: {} as Counter,
    storeKeys: {} as Counter,
    listenerCalls: {} as Counter,
    listenerMs: {} as Counter,
    listenerSiteCalls: {} as Counter,
    listenerSiteMs: {} as Counter,
    tasks: {} as Counter,
    taskMs: {} as Counter,
    taskLog: [] as [string, number][],
    commitTasks: {} as Counter,
    timers: {} as Counter,
    timerMs: {} as Counter,
    timersScheduled: {} as Counter,
    subNotified: {} as Counter,
    selectorCalls: {} as Counter,
    selectorMs: {} as Counter,
    writes: {} as Counter,
    writeBytes: {} as Counter,
    writeMs: {} as Counter,
    wasted: {} as Counter,
    wastedMs: {} as Counter,
    unstable: {} as Counter,
    unstableMs: {} as Counter,
    renderMs: {} as Counter,
    causes: {} as Record<string, Counter>,
    origins: {} as Counter,
    commitMs: 0,
  };
}

export type PerfStats = ReturnType<typeof fresh>;
