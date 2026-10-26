import { useEffect, useRef } from "react";
import { Animated } from "react-native";
import { curve } from "../../ui/motion";

export type Stop = readonly [number, number];

const SAMPLES = 8;
export const easeOut = (x: number) => 1 - (1 - x) ** 3;
export const linear = (x: number) => x;

export function track(p: Animated.Value, duration: number, stops: readonly Stop[], ease: (x: number) => number = easeOut) {
  const input: number[] = [];
  const output: number[] = [];
  const push = (ms: number, value: number) => {
    const last = input.length ? input[input.length - 1]! * duration : -Infinity;
    input.push(Math.max(ms, last + 0.5) / duration);
    output.push(value);
  };
  stops.forEach(([ms, value], i) => {
    if (i === 0) return push(ms, value);
    const [from, start] = stops[i - 1]!;
    if (value === start) return push(ms, value);
    for (let k = 1; k <= SAMPLES; k++) push(from + ((ms - from) * k) / SAMPLES, start + (value - start) * ease(k / SAMPLES));
  });
  if (input.length === 1) push(input[0]! * duration + 1, output[0]!);
  return p.interpolate({ inputRange: input, outputRange: output, extrapolate: "clamp" });
}

export type Tracker = ReturnType<typeof tracker>;

export function tracker(p: Animated.Value, duration: number) {
  const t = (stops: readonly Stop[], ease?: (x: number) => number) => track(p, duration, stops, ease);
  t.in = (ms: number, dur = 240) => track(p, duration, [[ms, 0], [ms + dur, 1]]);
  t.out = (ms: number, dur = 240) => track(p, duration, [[ms, 1], [ms + dur, 0]]);
  t.step = (ms: number, from = 0, to = 1) => track(p, duration, [[ms, from], [ms + 1, to]], linear);
  t.deg = (stops: readonly Stop[]) => track(p, duration, stops).interpolate({ inputRange: [0, 360], outputRange: ["0deg", "360deg"], extrapolate: "extend" });
  return t;
}

export function useDemo(active: boolean, duration: number) {
  const p = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) return;
    p.setValue(0);
    const run = Animated.timing(p, { toValue: 1, duration, easing: curve.linear, useNativeDriver: true, isInteraction: false });
    run.start();
    return () => {
      run.stop();
      p.setValue(1);
    };
  }, [active, duration]);
  return p;
}
