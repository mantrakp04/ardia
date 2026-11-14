import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { Backdrop } from "./Backdrop";
import { tabsCurve, tabsMotion } from "./motion";

export function FadingBackdrop({ colors }: { colors: readonly string[] }) {
  const key = colors.join("|");
  const shown = useRef(colors);
  const [previous, setPrevious] = useState<readonly string[] | null>(null);
  const fade = useSharedValue(0);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (shown.current.join("|") === key) return;
    setPrevious(shown.current);
    shown.current = colors;
    fade.value = 1;
    fade.value = withTiming(0, { duration: reduceMotion ? tabsMotion.fade : tabsMotion.toneFade, easing: tabsCurve.easeInOut });
  }, [key]);
  const old = useAnimatedStyle(() => ({ opacity: fade.value }));
  return (
    <>
      <Backdrop colors={colors} />
      {previous ? (
        <Animated.View style={[StyleSheet.absoluteFill, old]} pointerEvents="none">
          <Backdrop colors={previous} />
        </Animated.View>
      ) : null}
    </>
  );
}
