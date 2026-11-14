import { AccessibilityInfo } from "react-native";
import { cancelFrame, noteAnimation, requestFrame } from "../animation/motion";
import { PagerRegistry, type PagerSnapshot } from "./pager";

let reduceMotion = false;
let watchingReduceMotion = false;

function watchReduceMotion() {
  if (watchingReduceMotion) return;
  watchingReduceMotion = true;
  try {
    AccessibilityInfo.isReduceMotionEnabled().then(
      (on) => void (reduceMotion = on),
      () => {},
    );
    AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => void (reduceMotion = on));
  } catch {
    reduceMotion = false;
  }
}

export const pagers = new PagerRegistry({
  now: () => performance.now(),
  requestFrame,
  cancelFrame,
  reducedMotion: () => {
    watchReduceMotion();
    return reduceMotion;
  },
  startMotion: () => {
    const running = { __active: true };
    noteAnimation(running);
    return () => void (running.__active = false);
  },
});

const strings = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value) && value.every((id) => typeof id === "string") ? (value as string[]) : undefined;

export const windowsSwipe = {
  haptic(_pattern: string) {},
  switchPager(key: string, index: number, order?: readonly string[] | null): Promise<boolean> {
    return Promise.resolve(pagers.existing(key)?.switchTo(Math.trunc(index), strings(order)) ?? false);
  },
  stepPager(key: string, delta: number, wrap: boolean, order?: readonly string[] | null): Promise<boolean> {
    return Promise.resolve(pagers.existing(key)?.step(Math.trunc(delta), !!wrap, strings(order)) ?? false);
  },
  selectPager(key: string, profileId: string, order: readonly string[]): Promise<boolean> {
    const ids = strings(order);
    return Promise.resolve(ids ? (pagers.existing(key)?.select(profileId, ids) ?? false) : false);
  },
  pagerState(key: string): PagerSnapshot | null {
    return pagers.snapshot(key);
  },
  devPagerState(key: string): Promise<unknown> {
    return Promise.resolve(pagers.existing(key)?.debug() ?? null);
  },
  devSimulate(): Promise<unknown> {
    return Promise.resolve({ error: "swipe gestures have no Windows version yet" });
  },
};
