import { useInterfaceMetrics, scaleInterfaceStyle } from "../ui/interfaceSize";
import { scaleMetrics } from "../../lib/interfaceMetrics";
import { useMemo } from "react";
import { memo, useEffect, useRef } from "react";
import { Animated } from "react-native";
import { usePageProgress } from "../../state/tabs/pageProgress";
import { curve, ProgressTrack } from "../ui";
import { TOOLBAR_MOTION } from "./tokens";

const PROGRESS = { height: 1.5, floor: 0.08, opacity: 0.85 } as const;
const PLACE = { position: "absolute", left: 0, right: 0, bottom: 0, opacity: PROGRESS.opacity } as const;

export const TabProgressBar = memo(function TabProgressBar({ tabId, color }: { tabId: string; color: string }) {
  return <ProgressBar progress={usePageProgress(tabId)} color={color} />;
});

export function ProgressBar({ progress, color }: { progress: number; color: string }) {
  const interfaceScale = useInterfaceMetrics().factor;
  const { PROGRESS, TOOLBAR_MOTION, PLACE } = useMemo(() => ({ PROGRESS: scaleMetrics(BASE_INTERFACE_METRICS.PROGRESS, interfaceScale), TOOLBAR_MOTION: BASE_INTERFACE_METRICS.TOOLBAR_MOTION, PLACE: scaleInterfaceStyle(BASE_INTERFACE_METRICS.PLACE, interfaceScale) }), [interfaceScale]);
  const width = useRef(new Animated.Value(Math.max(progress, PROGRESS.floor))).current;
  const shownFor = useRef(Math.max(progress, PROGRESS.floor));
  useEffect(() => {
    const to = Math.max(progress, PROGRESS.floor);
    if (shownFor.current === to) return;
    shownFor.current = to;
    Animated.timing(width, { toValue: to, duration: TOOLBAR_MOTION.progress, easing: curve.enter, useNativeDriver: false }).start();
  }, [progress, interfaceScale]);
  return <ProgressTrack value={width} height={PROGRESS.height} color={color} track={false} style={PLACE} />;
}

const BASE_INTERFACE_METRICS = { PROGRESS, TOOLBAR_MOTION, PLACE };
