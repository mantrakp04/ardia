import { Symbol } from "@ardia/shell";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { useHover } from "../primitives";
import { useOnboardingColors } from "./ui";

const ADS = [
  { topic: "Travel", icon: "airplane", click: 0.22, dark: "#C2B2FF", light: "#7250B4", tint: "rgba(156,123,225,0.12)" },
  { topic: "Music", icon: "music.note", click: 0.43, dark: "#F2BC87", light: "#975516", tint: "rgba(221,157,93,0.12)" },
  { topic: "Gardens", icon: "leaf", click: 0.64, dark: "#9ED2B3", light: "#397553", tint: "rgba(99,172,127,0.12)" },
];

function useReducedMotion() {
  const [reduced, setReduced] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => {
      changed = true;
      if (alive) setReduced(on);
    });
    AccessibilityInfo.isReduceMotionEnabled().then(
      (on) => { if (alive && !changed) setReduced(on); },
      () => { if (alive && !changed) setReduced(true); },
    );
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

export function AdNauseamPreview() {
  const colors = useOnboardingColors();
  const { dark } = useTheme();
  const { hovered, hoverProps } = useHover();
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(1)).current;
  const [replay, setReplay] = useState(0);

  useEffect(() => {
    progress.setValue(reducedMotion === false ? 0 : 1);
    if (reducedMotion !== false) return;
    const animation = Animated.timing(progress, { toValue: 1, duration: 4800, easing: Easing.linear, useNativeDriver: true, isInteraction: false });
    animation.start();
    return () => animation.stop();
  }, [progress, reducedMotion, replay]);

  const fade = (inputRange: number[], outputRange: number[]) => progress.interpolate({ inputRange, outputRange, extrapolate: "clamp" });
  const move = (stops: number[], values: number[]) => {
    const inputRange: number[] = [];
    const outputRange: number[] = [];
    const ease = Easing.inOut(Easing.cubic);
    for (let segment = 0; segment < stops.length - 1; segment++) {
      for (let sample = 0; sample < 12; sample++) {
        const fraction = sample / 12;
        inputRange.push(stops[segment]! + (stops[segment + 1]! - stops[segment]!) * fraction);
        outputRange.push(values[segment]! + (values[segment + 1]! - values[segment]!) * ease(fraction));
      }
    }
    inputRange.push(stops.at(-1)!);
    outputRange.push(values.at(-1)!);
    return fade(inputRange, outputRange);
  };

  return (
    <View style={{ gap: 12 }}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel="Illustration: ads stay hidden from your page. AdNauseam clicks travel, music and gardening ads in the background. These add unrelated interests alongside cycling in an example advertising profile, aiming to make your real interests harder to identify. No real ads are clicked by this illustration."
        style={{ borderRadius: 18, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.rowBorder, backgroundColor: colors.card, padding: 14 }}
      >
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 10 }}>
            <Symbol name="eye.slash" size={12} color={colors.subtitle} style={{ width: 16, height: 16 }} />
            <Text style={{ fontSize: 11, fontWeight: "500", color: colors.subtitle }}>These ads stay hidden from your page</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {ADS.map(({ topic, icon, click, dark: night, light, tint }) => {
              const ink = dark ? night : light;
              return (
                <Animated.View key={topic} style={{ flex: 1, height: 66, borderRadius: 11, padding: 9, backgroundColor: tint, borderWidth: 1, borderColor: "transparent", transform: [{ scale: move([click - 0.02, click, click + 0.04], [1, 0.96, 1]) }] }}>
                  <Animated.View style={{ ...StyleSheet.absoluteFillObject, borderRadius: 10, borderWidth: 1, borderColor: ink, opacity: fade([click - 0.04, click, click + 0.11], [0, 0.8, 0]) }} />
                  <Symbol name={icon} size={18} color={ink} style={{ width: 20, height: 20 }} />
                  <Text style={{ marginTop: 4, fontSize: 11.5, fontWeight: "500", color: ink }}>{topic}</Text>
                  <View style={{ width: 35, height: 2, borderRadius: 2, marginTop: 4, backgroundColor: ink, opacity: 0.2 }} />
                </Animated.View>
              );
            })}
            <Animated.View pointerEvents="none" style={{ position: "absolute", top: 39, left: 34, opacity: fade([0.06, 0.12, 0.68, 0.74], [0, 1, 1, 0]), transform: [{ translateX: move([0.22, 0.36, 0.43, 0.57, 0.64], [0, 93, 93, 186, 186]) }, { translateY: move([0.2, 0.22, 0.26, 0.41, 0.43, 0.47, 0.62, 0.64, 0.68], [0, 3, 0, 0, 3, 0, 0, 3, 0]) }] }}>
              <Symbol name="cursorarrow" size={21} color={colors.title} style={{ width: 25, height: 28 }} />
            </Animated.View>
          </View>
          <View style={{ flexDirection: "row", gap: 8, height: 29 }}>
            {ADS.map(({ topic, click, dark: night, light }) => (
              <View key={topic} style={{ flex: 1, alignItems: "center" }}>
                <View style={{ width: 1, height: 29, backgroundColor: colors.separator }} />
                <Animated.View style={{ position: "absolute", top: 0, width: 5, height: 5, borderRadius: 2.5, backgroundColor: dark ? night : light, opacity: fade([click, click + 0.015, click + 0.11, click + 0.13], [0, 1, 1, 0]), transform: [{ translateY: move([click, click + 0.13], [0, 26]) }] }} />
              </View>
            ))}
          </View>
          <View style={{ padding: 12, borderRadius: 12, backgroundColor: colors.preview, borderWidth: 1, borderColor: colors.rowBorder }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.row }}>
                <Symbol name="person.fill" size={12} color={colors.subtitle} style={{ width: 16, height: 16 }} />
              </View>
              <View style={{ gap: 2 }}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.title }}>What advertisers infer</Text>
                <Text style={{ fontSize: 10, color: colors.footnote }}>An example interest profile</Text>
              </View>
            </View>
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, padding: 8, borderRadius: 7, backgroundColor: colors.row }}>
                  <View style={{ width: 6, height: 6, marginHorizontal: 4.5, borderRadius: 3, backgroundColor: colors.subtitle }} />
                  <Text style={{ fontSize: 11, color: colors.subtitle }}>Cycling</Text>
                </View>
                <Interest topic={ADS[0]!} progress={progress} />
              </View>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {ADS.slice(1).map((topic) => <Interest key={topic.topic} topic={topic} progress={progress} />)}
              </View>
            </View>
          </View>
          <View style={{ marginTop: 12, height: 36 }}>
            <Animated.Text style={{ position: "absolute", fontSize: 12, lineHeight: 17, color: colors.subtitle, opacity: fade([0.75, 0.8], [1, 0]) }}>Background clicks add unrelated interests.</Animated.Text>
            <Animated.Text style={{ position: "absolute", fontSize: 12, lineHeight: 17, color: colors.title, opacity: fade([0.82, 0.9], [0, 1]) }}>The aim: make your real interests harder to pick out.</Animated.Text>
          </View>
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 28 }}>
        <Text style={{ fontSize: 10, color: colors.footnote }}>Illustration only · no real clicks</Text>
        {reducedMotion === false ? (
          <View {...hoverProps}>
            <Pressable accessibilityRole="button" accessibilityLabel="Replay the AdNauseam explanation" onPress={() => setReplay((value) => value + 1)}>
              {({ pressed }) => (
                <View mouseDownCanMoveWindow={false} style={{ flexDirection: "row", alignItems: "center", gap: 5, minHeight: 28, paddingHorizontal: 8, borderRadius: 7, backgroundColor: pressed ? colors.button : hovered ? colors.buttonHover : "transparent", transform: [{ scale: pressed ? 0.97 : 1 }] }}>
                  <Symbol name="arrow.counterclockwise" size={10} color={colors.subtitle} style={{ width: 12, height: 12 }} />
                  <Text style={{ fontSize: 11, fontWeight: "500", color: colors.title }}>Replay</Text>
                </View>
              )}
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Interest({ topic, progress }: { topic: typeof ADS[number]; progress: Animated.Value }) {
  const { dark } = useTheme();
  const ink = dark ? topic.dark : topic.light;
  const reveal = progress.interpolate({ inputRange: [topic.click + 0.1, topic.click + 0.16], outputRange: [0, 1], extrapolate: "clamp" });
  return (
    <Animated.View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, padding: 8, borderRadius: 7, backgroundColor: topic.tint, opacity: reveal, transform: [{ translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }] }}>
      <Symbol name={topic.icon} size={12} color={ink} style={{ width: 15, height: 15 }} />
      <Text style={{ fontSize: 11, color: ink }}>{topic.topic}</Text>
    </Animated.View>
  );
}
