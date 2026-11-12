import { useRef } from "react";
import { Animated, type ViewProps } from "react-native";
import { springs } from "./motion";
import { MagnifyArea } from "./native";
import { pinchStep, type PinchMotion } from "./pinch";

export const PINCH_SPRING = { ...springs.snappy, overshootClamping: true, restDisplacementThreshold: 0.001, restSpeedThreshold: 0.01, useNativeDriver: true } as const;

export function pinchSettle(values: { value: Animated.Value; to: number }[]) {
  Animated.parallel(values.map(({ value, to }) => Animated.spring(value, { toValue: to, ...PINCH_SPRING }))).start();
}

export function PinchArea({ motion, enabled = true, ...props }: ViewProps & { motion: PinchMotion; enabled?: boolean }) {
  const latest = useRef(motion);
  latest.current = motion;
  return <MagnifyArea enabled={enabled} onMagnify={({ phase, magnification }) => pinchStep(latest.current, phase, magnification)} {...props} />;
}
