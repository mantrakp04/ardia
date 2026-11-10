import { forwardRef, useCallback, useEffect, useState, type ReactNode } from "react";
import { Animated, Easing, StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from "react-native";
import { useDark, type AnyProps } from "./shared";

const LINE_WIDTH = 1.5;
const RING_INSET = 1.25 - LINE_WIDTH / 2;
const TURN_MS = 1880;
const TRACK_ALPHA = 0.18;
const SECONDARY_LABEL = { light: "rgba(0,0,0,0.5)", dark: "rgba(255,255,255,0.55)" };
const SECONDARY_TRACK = { light: `rgba(0,0,0,${0.5 * TRACK_ALPHA})`, dark: `rgba(255,255,255,${0.55 * TRACK_ALPHA})` };

const turn = new Animated.Value(0);
const rotation = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
let spinners = 0;
let loop: Animated.CompositeAnimation | null = null;

function startSpinning() {
  spinners += 1;
  if (loop) return;
  turn.setValue(0);
  loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: TURN_MS, easing: Easing.linear, useNativeDriver: true }));
  loop.start();
}

function stopSpinning() {
  spinners = Math.max(0, spinners - 1);
  if (spinners > 0 || !loop) return;
  loop.stop();
  loop = null;
}

export const ActivitySpinner = forwardRef<View, AnyProps>(function ActivitySpinner({ style, onLayout, children, ...rest }, ref) {
  const tone = useDark(undefined) ? "dark" : "light";
  const [size, setSize] = useState(0);
  useEffect(() => {
    startSpinning();
    return stopSpinning;
  }, []);
  const measure = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      setSize(Math.min(width, height));
      if (typeof onLayout === "function") onLayout(event);
    },
    [onLayout],
  );
  const diameter = Math.max(0, size - 2 * RING_INSET);
  const ring: ViewStyle = { position: "absolute", left: RING_INSET, top: RING_INSET, width: diameter, height: diameter, borderRadius: diameter / 2, borderWidth: LINE_WIDTH };
  return (
    <View {...rest} ref={ref} onLayout={measure} pointerEvents="none" style={style as ViewStyle}>
      {diameter > 0 ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <View style={[ring, { borderColor: SECONDARY_TRACK[tone] }]} />
          <Animated.View
            style={[
              ring,
              { borderTopColor: SECONDARY_LABEL[tone], borderRightColor: SECONDARY_LABEL[tone], borderBottomColor: SECONDARY_LABEL[tone], borderLeftColor: "transparent", transform: [{ rotate: rotation }] },
            ]}
          />
        </View>
      ) : null}
      {children as ReactNode}
    </View>
  );
});
