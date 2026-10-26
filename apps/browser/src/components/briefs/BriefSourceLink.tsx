import { briefColors, briefMotion } from "./tokens";
import { registerBriefHover } from "./devDriver";
import { useWindowId } from "../../state/browser/hooks";
import { useEffect, useId, useRef, useState } from "react";
import { Animated, Image, Linking, Pressable, Text, View } from "react-native";
import { isSafeBriefSource, type BriefSource } from "../../lib/briefContent";

export function BriefSourceLink({ source }: { source: BriefSource }) {
  const view = useRef<View>(null);
  const windowId = useWindowId();
  const instanceId = useId();
  const [hovered, setHovered] = useState(false);
  const tilt = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!__DEV__) return;
    const key = `${windowId}:${instanceId}:${source.url}`;
    return registerBriefHover(key, { hovered, measure: () => new Promise((resolve) => { if (view.current) view.current.measureInWindow((x, y, width, height) => resolve([x, y, width, height])); else resolve([]); }) });
  }, [hovered, source.url, windowId, instanceId]);
  useEffect(() => {
    Animated.timing(tilt, { toValue: hovered ? 1 : 0, duration: briefMotion.tilt, useNativeDriver: true }).start();
    return () => tilt.stopAnimation();
  }, [hovered, tilt]);
  if (!isSafeBriefSource(source)) return null;
  const name = source.kind === "github" ? "GitHub" : "Gmail";
  return <View ref={view} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ width: 24, height: 24, position: "relative", zIndex: hovered ? 50 : 0 }}><Pressable accessibilityRole="link" accessibilityLabel={`Open in ${name}`} onPress={() => void Linking.openURL(source.url).catch(() => {})} style={({ pressed }) => ({ width: 24, height: 24, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}><Animated.View pointerEvents="none" style={{ width: 20, height: 20, transform: [{ rotate: tilt.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "12deg"] }) }] }}><Image source={source.kind === "github" ? require("../../../assets/site-icons/github.png") : require("../../../assets/site-icons/gmail.png")} resizeMode="contain" style={{ width: 20, height: source.kind === "gmail" ? 15 : 20, marginTop: source.kind === "gmail" ? 2.5 : 0, ...(source.kind === "github" ? { tintColor: briefColors.foreground } : {}) }} /></Animated.View></Pressable>{hovered && <View pointerEvents="none" style={{ position: "absolute", bottom: 30, left: -47, width: 118, borderRadius: 6, backgroundColor: briefColors.foreground, paddingVertical: 7, alignItems: "center" }}><Text style={{ color: briefColors.tooltipInk, fontSize: 12, lineHeight: 16 }}>Open in {name}</Text></View>}</View>;
}
