import { useMemo, useRef } from "react";
import { Animated, PanResponder, type GestureResponderHandlers } from "react-native";
import { curve, duration } from "../ui/motion";

const BAND = 36;
const BAND_SCALE = 90;

export function useResizeDrag(o: {
  min: number;
  max: number;
  direction: 1 | -1;
  saved: () => number;
  onLive: (width: number | null) => void;
  onCommit: (width: number) => void;
}): GestureResponderHandlers {
  const latest = useRef(o);
  latest.current = o;
  return useMemo(() => {
    let live: number | null = null;
    let start = 0;
    let spring: Animated.CompositeAnimation | null = null;
    const show = (width: number) => {
      live = width;
      latest.current.onLive(width);
    };
    const commit = (width: number) => {
      live = null;
      latest.current.onCommit(width);
      latest.current.onLive(null);
    };
    const band = (over: number) => BAND * (1 - Math.exp(-over / BAND_SCALE));
    const unband = (stretch: number) => -BAND_SCALE * Math.log(1 - Math.min(stretch, BAND - 0.01) / BAND);
    const rubberBand = (width: number) => {
      const { min, max } = latest.current;
      if (width > max) return max + band(width - max);
      if (width < min) return min - band(min - width);
      return width;
    };
    const unstretch = (width: number) => {
      const { min, max } = latest.current;
      if (width > max) return max + unband(width - max);
      if (width < min) return min - unband(min - width);
      return width;
    };
    const clamp = (width: number) => Math.min(latest.current.max, Math.max(latest.current.min, width));
    const at = (dx: number) => rubberBand(start + latest.current.direction * dx);
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        spring?.stop();
        spring = null;
        start = unstretch(live ?? latest.current.saved());
        show(rubberBand(start));
      },
      onPanResponderMove: (_, g) => show(at(g.dx)),
      onPanResponderRelease: (_, g) => {
        const raw = at(g.dx);
        const target = clamp(raw);
        if (raw === target) return commit(target);
        const value = new Animated.Value(raw);
        value.addListener(({ value: v }) => show(v));
        const mine = Animated.timing(value, { toValue: target, duration: duration.resize, easing: curve.outBack, useNativeDriver: false });
        spring = mine;
        mine.start(({ finished }) => {
          value.removeAllListeners();
          if (!finished) return;
          spring = null;
          commit(target);
        });
      },
      onPanResponderTerminate: () => commit(clamp(live ?? latest.current.saved())),
      onPanResponderTerminationRequest: () => false,
    }).panHandlers;
  }, []);
}
