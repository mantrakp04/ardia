import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { useLastingLoad } from "../../state/tabs/lastingLoad";
import { usePageProgress } from "../../state/tabs/pageProgress";
import { notePageOverlay } from "../../state/telemetry/usage";
import { GradientFill, reduceMotion, type GradientStop } from "../ui";
import { FIELD_LOAD } from "./tokens";

const { floor, motion } = FIELD_LOAD;

const lined = (glow: readonly GradientStop[], height: number): GradientStop[] => {
  const lineTop = 1 - FIELD_LOAD.line / height;
  return [...glow.map(([at, alpha]) => [at * lineTop, alpha] as const), [lineTop, 1], [1, 1]];
};
const TAIL_GLOW: GradientStop[] = FIELD_LOAD.glow.map(([at, alpha]) => [at, Math.min(alpha, FIELD_LOAD.tailCeiling)]);
const CAP_GLOW: GradientStop[] = FIELD_LOAD.glow.map(([at, alpha]) => [at, alpha - Math.min(alpha, FIELD_LOAD.tailCeiling)]);
const fadingPast = (body: number, front: number, falloff: readonly number[]): GradientStop[] => [
  [0, 1],
  ...falloff.map((alpha, i) => [(body + (front * i) / (falloff.length - 1)) / (body + front), alpha] as const),
];

export const FieldLoadFill = memo(function FieldLoadFill({ tabId, color, height, radius }: { tabId: string; color: string; height: number; radius: number }) {
  const loading = useLastingLoad(tabId);
  const progress = usePageProgress(tabId);
  const [mounted, setMounted] = useState(loading);
  if (loading && !mounted) setMounted(true);
  const [width, setWidth] = useState(0);
  const filled = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const comet = useRef(new Animated.Value(0)).current;
  const stops = useMemo(() => lined(FIELD_LOAD.glow, height), [height]);
  const capStops = useMemo(() => lined(CAP_GLOW, height), [height]);
  const frontScale = Math.min(1, (width * FIELD_LOAD.frontShareOfField) / FIELD_LOAD.tail);
  const tail = FIELD_LOAD.tail * frontScale;
  const cap = FIELD_LOAD.cap * frontScale;
  const tailFade = useMemo(() => fadingPast(width, tail, FIELD_LOAD.tailFade), [width, tail]);
  const capFade = useMemo(() => fadingPast(width, cap, FIELD_LOAD.capFade), [width, cap]);
  const cometFade = useMemo((): GradientStop[] => [[0, 0], ...fadingPast(width, cap, FIELD_LOAD.capFade).slice(1)], [width, cap]);

  useEffect(() => {
    if (!mounted) return;
    if (loading) {
      notePageOverlay("loadingField");
      filled.setValue(0);
      comet.setValue(0);
      Animated.timing(opacity, { toValue: 1, ...motion.show, useNativeDriver: true }).start();
      return;
    }
    const still = reduceMotion();
    if (still) {
      filled.setValue(1);
      comet.setValue(1);
    }
    const sweep = Animated.parallel([
      Animated.timing(filled, { toValue: 1, ...motion.finish, useNativeDriver: true }),
      Animated.timing(comet, { toValue: 1, ...motion.finish, useNativeDriver: true }),
    ]);
    const leave = Animated.sequence([...(still ? [] : [sweep]), Animated.delay(motion.hold), Animated.timing(opacity, { toValue: 0, ...motion.hide, useNativeDriver: true })]);
    leave.start(({ finished }) => finished && setMounted(false));
    return () => leave.stop();
  }, [loading, mounted]);

  useEffect(() => {
    if (!mounted || !loading || !width) return;
    const to = Math.max(floor, Math.min(progress, 1 - tail / width));
    if (reduceMotion()) filled.setValue(to);
    else Animated.timing(filled, { toValue: to, ...motion.progress, useNativeDriver: true }).start();
  }, [progress, loading, mounted, width, tail]);

  if (!mounted) return null;
  return (
    <View pointerEvents="none" onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: "hidden" }]}>
      {width > 0 && (
        <Animated.View
          style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: width + tail, opacity, transform: [{ translateX: filled.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }) }] }}
        >
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: comet.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>
            <GradientFill color={color} stops={TAIL_GLOW} fade={tailFade} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: width + tail }} />
            <GradientFill color={color} stops={capStops} fade={capFade} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: width + cap }} />
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: comet }]}>
            <GradientFill color={color} stops={stops} fade={cometFade} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: width + cap }} />
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
});
