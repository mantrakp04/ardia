import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Text, View, type TextStyle } from "react-native";
import { curve } from "../ui/motion";
import { fadeStepColor, mediaMotion } from "./tokens";

const FADE = 12;
const FADE_STEPS = 6;

type MarqueeGroup = {
  progress: Animated.Value;
  report(key: string, overflow: number): void;
};

export function useMarqueeGroup(resetKey: string, iterations = -1): MarqueeGroup {
  const progress = useRef(new Animated.Value(0)).current;
  const [overflows, setOverflows] = useState<Record<string, number>>({});
  const max = Math.max(0, ...Object.values(overflows));
  useEffect(() => {
    progress.setValue(0);
    if (max < 1 || iterations === 0) return;
    const duration = (max / mediaMotion.marqueeSpeed) * 1000;
    const leg = (toValue: number) => Animated.timing(progress, { toValue, duration, easing: curve.linear, useNativeDriver: true });
    const loop = Animated.loop(Animated.sequence([Animated.delay(mediaMotion.marqueePause), leg(1), Animated.delay(mediaMotion.marqueePause), leg(0)]), { iterations });
    loop.start();
    return () => loop.stop();
  }, [max, resetKey, iterations]);
  return useMemo(
    () => ({
      progress,
      report: (key, overflow) => setOverflows((o) => (Math.abs((o[key] ?? 0) - overflow) < 0.5 ? o : { ...o, [key]: overflow })),
    }),
    [progress],
  );
}

export function Marquee({
  id,
  text,
  group,
  style,
  height,
  background,
}: {
  id: string;
  text: string;
  group: MarqueeGroup;
  style: TextStyle;
  height: number;
  background?: [number, number, number];
}) {
  const [box, setBox] = useState(0);
  const [natural, setNatural] = useState(0);
  const overflow = box > 0 && natural > box + 0.5 ? natural - box : 0;
  useEffect(() => group.report(id, overflow), [overflow]);
  const x = overflow ? group.progress.interpolate({ inputRange: [0, 1], outputRange: [0, -overflow] }) : 0;
  const line = (left: number, measure: boolean) => (
    <Animated.View style={{ position: "absolute", left: -left, top: 0, height, width: 4000, flexDirection: "row", alignItems: "center", transform: [{ translateX: x }] }}>
      <Text numberOfLines={1} onLayout={measure ? (e) => setNatural(e.nativeEvent.layout.width) : undefined} style={style}>
        {text}
      </Text>
    </Animated.View>
  );
  return (
    <View style={{ height, overflow: "hidden" }} onLayout={(e) => setBox(e.nativeEvent.layout.width)}>
      {!overflow ? (
        line(0, true)
      ) : background ? (
        <>
          {line(0, true)}
          <Fade side="left" opacity={group.progress.interpolate({ inputRange: [0, 0.03], outputRange: [0, 1], extrapolate: "clamp" })} background={background} height={height} />
          <Fade side="right" opacity={group.progress.interpolate({ inputRange: [0.97, 1], outputRange: [1, 0], extrapolate: "clamp" })} background={background} height={height} />
        </>
      ) : (
        <>
          <View style={{ position: "absolute", left: FADE, top: 0, width: Math.max(0, box - FADE * 2), height, overflow: "hidden" }}>{line(FADE, true)}</View>
          {Array.from({ length: FADE_STEPS }, (_, i) => {
            const left = (i * FADE) / FADE_STEPS;
            const kept = (i + 0.5) / FADE_STEPS;
            const opacity = group.progress.interpolate({ inputRange: [0, 0.03], outputRange: [1, kept], extrapolate: "clamp" });
            return <FadeSlice key={`l${i}`} left={left} height={height} opacity={opacity} line={line(left, false)} />;
          })}
          {Array.from({ length: FADE_STEPS }, (_, i) => {
            const left = box - FADE + (i * FADE) / FADE_STEPS;
            const kept = 1 - (i + 0.5) / FADE_STEPS;
            const opacity = group.progress.interpolate({ inputRange: [0.97, 1], outputRange: [kept, 1], extrapolate: "clamp" });
            return <FadeSlice key={`r${i}`} left={left} height={height} opacity={opacity} line={line(left, false)} />;
          })}
        </>
      )}
    </View>
  );
}

function FadeSlice({ left, height, opacity, line }: { left: number; height: number; opacity: Animated.AnimatedInterpolation<number>; line: ReactNode }) {
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", left, top: 0, width: FADE / FADE_STEPS, height, overflow: "hidden", opacity }}>
      {line}
    </Animated.View>
  );
}

function Fade({ side, opacity, background, height }: { side: "left" | "right"; opacity: Animated.AnimatedInterpolation<number> | number; background: [number, number, number]; height: number }) {
  const w = FADE / FADE_STEPS;
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", top: 0, [side]: 0, width: FADE, height, flexDirection: side === "left" ? "row" : "row-reverse", opacity }}>
      {Array.from({ length: FADE_STEPS }, (_, i) => (
        <View key={i} style={{ width: w, height, backgroundColor: fadeStepColor(background, 1 - (i + 0.5) / FADE_STEPS) }} />
      ))}
    </Animated.View>
  );
}
