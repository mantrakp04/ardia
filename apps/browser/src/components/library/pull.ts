import { pagerState } from "@ardia/ardiacore";
import { Animated, Easing } from "react-native";
import { create } from "zustand";
import { PULL_OPENS_AT, pullProgress, RUBBER_FULL_PULL, trackPull, type PullTrack } from "./pullDecision";
import { librarySection, openLibrary } from "./state";

export { PULL_OPENS_AT, RUBBER_FULL_PULL } from "./pullDecision";

export const useLibraryPull = create<{ pulling: Record<string, true>; sources: Record<string, Animated.AnimatedInterpolation<number>> }>(() => ({
  pulling: {},
  sources: {},
}));

const reveals = new Map<string, Animated.Value>();
const pulled = new Map<string, number>();
const pagerPulls = new Map<string, PullTrack>();

export function libraryReveal(windowId: string): Animated.Value {
  let v = reveals.get(windowId);
  if (!v) reveals.set(windowId, (v = new Animated.Value(0)));
  return v;
}

function setPulling(windowId: string, on: boolean) {
  useLibraryPull.setState((s) => {
    const { [windowId]: _, ...rest } = s.pulling;
    return { pulling: on ? { ...rest, [windowId]: true } : rest };
  });
}

export function attachPagerPull(windowId: string, position: Animated.Value) {
  const source = position.interpolate({ inputRange: [-RUBBER_FULL_PULL, 0], outputRange: [1, 0], extrapolate: "clamp" });
  useLibraryPull.setState((s) => ({ sources: { ...s.sources, [windowId]: source } }));
  return () =>
    useLibraryPull.setState((s) => {
      if (s.sources[windowId] !== source) return s;
      const { [windowId]: _, ...sources } = s.sources;
      return { sources };
    });
}

function fingerDown(windowId: string): boolean {
  const phase = pagerState(windowId)?.phase;
  return phase === "tracking" || phase === "holding";
}

export function notePagerPull(windowId: string, position: number) {
  if (librarySection(windowId)) return;
  const step = trackPull(pagerPulls.get(windowId) ?? { pulling: false, held: null }, pullProgress(position), fingerDown(windowId));
  pagerPulls.set(windowId, { pulling: step.pulling, held: step.held });
  if (step.pulling !== !!useLibraryPull.getState().pulling[windowId] && step.open === null) setPulling(windowId, step.pulling);
  if (step.open === null) return;
  pagerPulls.delete(windowId);
  libraryReveal(windowId).setValue(step.open);
  openLibrary(windowId, "spaces");
  setPulling(windowId, false);
}

export function endPagerPull(windowId: string, phase: "began" | "selected" | "settled") {
  if (phase === "selected") return;
  pagerPulls.delete(windowId);
  if (useLibraryPull.getState().pulling[windowId]) setPulling(windowId, false);
}

export function pullLibrary(windowId: string, progress: number) {
  if (librarySection(windowId)) return;
  const p = Math.max(0, Math.min(1, progress));
  if (!useLibraryPull.getState().pulling[windowId]) {
    if (p <= 0.02) return;
    setPulling(windowId, true);
  }
  pulled.set(windowId, p);
  libraryReveal(windowId).setValue(p);
}

export function libraryPulled(windowId: string): number {
  return useLibraryPull.getState().pulling[windowId] ? (pulled.get(windowId) ?? 0) : 0;
}

export function endLibraryPull(windowId: string, open = libraryPulled(windowId) >= PULL_OPENS_AT) {
  if (!useLibraryPull.getState().pulling[windowId]) return;
  pulled.delete(windowId);
  if (open) {
    openLibrary(windowId, "spaces");
    setPulling(windowId, false);
    return;
  }
  Animated.timing(libraryReveal(windowId), { toValue: 0, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => setPulling(windowId, false));
}
