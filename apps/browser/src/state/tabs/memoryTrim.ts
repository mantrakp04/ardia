import { inputIdleSeconds, trimEngineMemory } from "../../platform/performance";
import { useBrowser } from "../browser/store";
import { isQuitting } from "../app/nativeSync";

const QUIET_MS = 5000;
const MIN_GAP_MS = 30000;
const STEP_MS = 250;
const BUSY_RETRY_MS = 1000;
const MAX_COLLECTIONS = 8;
const MAX_POSTPONES = 30;
const INPUT_IDLE_SECONDS = 2;
const TIMER_LATE_MS = 50;

type HermesStats = { js_heapSize?: number };
const runtime = globalThis as { gc?: () => void; HermesInternal?: { getInstrumentedStats?: () => HermesStats } };

const heapSize = () => runtime.HermesInternal?.getInstrumentedStats?.().js_heapSize ?? null;

let started = false;

export function startMemoryTrim() {
  if (started) return;
  const compactsHeap = typeof runtime.gc === "function" && heapSize() !== null;
  started = true;

  let tabCount = Object.keys(useBrowser.getState().tabs).length;
  let lastTrimAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const later = (fn: (lateMs: number) => void, ms: number) => {
    const due = Date.now() + ms;
    timer = setTimeout(() => {
      timer = null;
      fn(Date.now() - due);
    }, ms);
  };

  const idle = (lateMs: number) => lateMs < TIMER_LATE_MS && (inputIdleSeconds() ?? Infinity) >= INPUT_IDLE_SECONDS;

  const finish = () => {
    if (!isQuitting()) trimEngineMemory().catch(() => {});
  };

  const compact = (step: number, before: number, postponed: number, lateMs: number) => {
    if (isQuitting()) return;
    if (!idle(lateMs)) {
      if (postponed < MAX_POSTPONES) later((late) => compact(step, before, postponed + 1, late), BUSY_RETRY_MS);
      return;
    }
    runtime.gc!();
    const after = heapSize() ?? before;
    if (after < before && step + 1 < MAX_COLLECTIONS) later((late) => compact(step + 1, after, postponed, late), STEP_MS);
    else finish();
  };

  const begin = (lateMs: number, postponed = 0) => {
    if (isQuitting()) return;
    const wait = lastTrimAt + MIN_GAP_MS - Date.now();
    if (wait > 0) return later((late) => begin(late, postponed), wait);
    if (!idle(lateMs)) {
      if (postponed < MAX_POSTPONES) later((late) => begin(late, postponed + 1), BUSY_RETRY_MS);
      return;
    }
    lastTrimAt = Date.now();
    if (compactsHeap) compact(0, heapSize() ?? 0, 0, 0);
    else finish();
  };

  useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs) return;
    const count = Object.keys(s.tabs).length;
    if (count === tabCount) return;
    tabCount = count;
    cancel();
    later(begin, QUIET_MS);
  });
}
