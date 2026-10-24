import { Animated, Easing } from "react-native";
import { create } from "zustand";
import { librarySection, openLibrary } from "./state";

export const useLibraryPull = create<{ pulling: Record<string, true>; sources: Record<string, Animated.AnimatedInterpolation<number>> }>(() => ({
  pulling: {},
  sources: {},
}));

const reveals = new Map<string, Animated.Value>();
const pulled = new Map<string, number>();
export const PULL_OPENS_AT = 0.45;
export const RUBBER_FULL_PULL = 0.09;

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

export function notePagerPull(windowId: string, position: number) {
  if (librarySection(windowId)) return;
  const progress = Math.min(1, Math.max(0, -position / RUBBER_FULL_PULL));
  if (!useLibraryPull.getState().pulling[windowId]) {
    if (progress <= 0.02) return;
    setPulling(windowId, true);
  }
  pulled.set(windowId, Math.max(pulled.get(windowId) ?? 0, progress));
}

export function endPagerPull(windowId: string, phase: "began" | "selected" | "settled") {
  if (!useLibraryPull.getState().pulling[windowId]) return;
  const reached = pulled.get(windowId) ?? 0;
  if (phase !== "began" && reached >= PULL_OPENS_AT) {
    pulled.delete(windowId);
    libraryReveal(windowId).setValue(reached);
    openLibrary(windowId, "spaces");
    setPulling(windowId, false);
    return;
  }
  if (phase === "settled") {
    pulled.delete(windowId);
    if (!librarySection(windowId)) setPulling(windowId, false);
  }
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
  Animated.timing(libraryReveal(windowId), { toValue: 0, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => {
    if (!librarySection(windowId)) setPulling(windowId, false);
  });
}
