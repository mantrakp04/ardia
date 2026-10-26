import { memo, useEffect, useRef } from "react";
import { Animated } from "react-native";
import { usePageProgress } from "../../state/tabs/pageProgress";
import { curve } from "../ui/motion";
import { TOOLBAR_MOTION } from "./tokens";

export const TabProgressBar = memo(function TabProgressBar({ tabId, color }: { tabId: string; color: string }) {
  return <ProgressBar progress={usePageProgress(tabId)} color={color} />;
});

export function ProgressBar({ progress, color }: { progress: number; color: string }) {
  const width = useRef(new Animated.Value(Math.max(progress, 0.08))).current;
  const shownFor = useRef(Math.max(progress, 0.08));
  useEffect(() => {
    const to = Math.max(progress, 0.08);
    if (shownFor.current === to) return;
    shownFor.current = to;
    Animated.timing(width, { toValue: to, duration: TOOLBAR_MOTION.progress, easing: curve.outQuad, useNativeDriver: false }).start();
  }, [progress]);
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: 0,
        bottom: 0,
        height: 1.5,
        width: width.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
        backgroundColor: color,
        opacity: 0.85,
      }}
    />
  );
}
