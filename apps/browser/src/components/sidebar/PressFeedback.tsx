import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { AccessibilityInfo, Animated, type StyleProp, type ViewStyle } from "react-native";
import { curve } from "../ui/motion";
import { SIDEBAR_MOTION } from "./tokens";

const PRESSED_SCALE = 0.99;
const PRESSED_OPACITY = 0.95;
const PRESS_IN_MS = SIDEBAR_MOTION.pressIn;
const PRESS_OUT_MS = SIDEBAR_MOTION.pressOut;
const PRESS_EASING = curve.outCubic;

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled().then(
  (on) => (reduceMotion = on),
  () => {},
);
AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => (reduceMotion = on));

export type PressMotion = { opacity: Animated.AnimatedInterpolation<number>; transform: { scale: Animated.AnimatedInterpolation<number> }[] };

export function usePressMotion(pressed: boolean): PressMotion | null {
  const progress = useRef<Animated.Value | null>(null);
  if (pressed && !progress.current) progress.current = new Animated.Value(0);
  const value = progress.current;
  const still = reduceMotion;
  const motion = useMemo(
    () =>
      value && {
        opacity: value.interpolate({ inputRange: [0, 1], outputRange: [1, PRESSED_OPACITY] }),
        transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [1, still ? 1 : PRESSED_SCALE] }) }],
      },
    [value, still],
  );
  useEffect(() => {
    if (!value) return;
    const animation = Animated.timing(value, { toValue: pressed ? 1 : 0, duration: pressed ? PRESS_IN_MS : PRESS_OUT_MS, easing: PRESS_EASING, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [pressed, value]);
  return motion;
}

export function PressFeedback({ pressed, style, children }: { pressed: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const motion = usePressMotion(pressed);
  return <Animated.View style={[style, motion]}>{children}</Animated.View>;
}
