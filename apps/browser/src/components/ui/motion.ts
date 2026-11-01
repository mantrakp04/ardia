import { useEffect, useRef, useState } from "react";
import { Animated, Easing, type EasingFunction } from "react-native";

export const curve = {
  linear: Easing.linear,
  enter: Easing.out(Easing.cubic),
  exit: Easing.in(Easing.quad),
  move: Easing.inOut(Easing.quad),
  pulse: Easing.inOut(Easing.sin),
  outExpo: Easing.out(Easing.exp),
  fade: Easing.bezier(0.25, 0.46, 0.45, 0.94),
  cssEase: Easing.bezier(0.25, 0.1, 0.25, 1),
  cssEaseOut: Easing.bezier(0, 0, 0.58, 1),
} as const;

export const duration = {
  fast: 100,
  base: 150,
  slow: 250,
  long: 400,
} as const;

export const period = { spinner: 900, pulse: 1100 } as const;

export type Fade = { duration: number; easing: EasingFunction; delay?: number };

export function usePresence<T>(value: T | null, motion: { show: Fade; hide: Fade }) {
  const showing = value !== null;
  const last = useRef(value);
  if (showing) last.current = value;
  const [mounted, setMounted] = useState(showing);
  if (showing && !mounted) setMounted(true);
  const appear = useRef(new Animated.Value(showing ? 1 : 0)).current;
  useEffect(() => {
    const run = Animated.timing(appear, { toValue: showing ? 1 : 0, ...(showing ? motion.show : motion.hide), useNativeDriver: true });
    run.start(({ finished }) => finished && !showing && setMounted(false));
    return () => run.stop();
  }, [showing]);
  return { shown: showing || mounted ? last.current : null, appear };
}

export type SpringSpec = { response: number; damping: number };

export function spring({ response, damping }: SpringSpec) {
  const omega = (2 * Math.PI) / response;
  return { stiffness: omega * omega, damping: 2 * damping * omega, mass: 1 };
}

export const springSpec = {
  snappy: { response: 0.2, damping: 0.9 },
  smooth: { response: 0.4, damping: 0.85 },
  bouncy: { response: 0.3, damping: 0.6 },
} as const satisfies Record<string, SpringSpec>;

export const springs = {
  snappy: spring(springSpec.snappy),
  smooth: spring(springSpec.smooth),
  bouncy: spring(springSpec.bouncy),
} as const;
