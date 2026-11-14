const none = () => ({ captureIndicatorsCleared: 0, pinnedTabsSleptByMemorySaver: 0, tabsSleptOverCap: 0 });

let pending = none();

export function noteCaptureIndicatorCleared() {
  pending.captureIndicatorsCleared++;
}

export function noteTabSlept(pinned: boolean, reason: string | null) {
  if (pinned && reason === "proactive") pending.pinnedTabsSleptByMemorySaver++;
}

export function noteTabSleptOverCap() {
  pending.tabsSleptOverCap++;
}

export function takeTabSleepCounts() {
  const taken = pending;
  pending = none();
  return {
    capture_indicators_cleared: taken.captureIndicatorsCleared,
    pinned_tabs_slept_by_memory_saver: taken.pinnedTabsSleptByMemorySaver,
    tabs_slept_over_cap: taken.tabsSleptOverCap,
  };
}
