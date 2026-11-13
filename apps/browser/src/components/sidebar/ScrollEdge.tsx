import { useInterfaceMetrics, scaleInterfaceStyle } from "../ui/interfaceSize";
import { scaleMetrics } from "../../lib/interfaceMetrics";
import { useMemo } from "react";
import { useState } from "react";
import { Animated } from "react-native";
import { useTheme } from "../ui/theme";
import { space } from "../ui/tokens";
import { curve, duration } from "../ui/motion";

export const SCROLL_EDGE = { gap: space.xs, line: 1, inset: 1 } as const;
const FADE = { duration: duration.fast, easing: curve.fade };

export function scrolledPastTop(offset: number): boolean {
  return offset > 0;
}

export function useScrollEdge() {
  const interfaceScale = useInterfaceMetrics().factor;
  const { FADE } = useMemo(() => ({ FADE: scaleMetrics(BASE_INTERFACE_METRICS.FADE, interfaceScale) }), [interfaceScale]);
  const [edge] = useState(() => {
    const opacity = new Animated.Value(0);
    let shown = false;
    return {
      opacity,
      follow(offset: number) {
        const next = scrolledPastTop(offset);
        if (next === shown) return;
        shown = next;
        Animated.timing(opacity, { toValue: next ? 1 : 0, ...FADE, useNativeDriver: true }).start();
      },
    };
  });
  return edge;
}

export function ScrollEdgeLine({ opacity }: { opacity: Animated.Value }) {
  const interfaceScale = useInterfaceMetrics().factor;
  const { SCROLL_EDGE } = useMemo(() => ({ SCROLL_EDGE: scaleMetrics(BASE_INTERFACE_METRICS.SCROLL_EDGE, interfaceScale) }), [interfaceScale]);
  const theme = useTheme();
  return <Animated.View pointerEvents="none" style={{ height: SCROLL_EDGE.line, backgroundColor: theme.divider, opacity }} />;
}

const BASE_INTERFACE_METRICS = { FADE, SCROLL_EDGE };
