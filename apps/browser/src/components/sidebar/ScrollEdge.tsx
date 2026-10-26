import { useState } from "react";
import { Animated } from "react-native";
import { useTheme } from "../ui/theme";
import { curve, duration } from "../ui/motion";

export const SCROLL_EDGE = { gap: 4, line: 1, inset: 1 } as const;
const FADE = { duration: duration.instant, easing: curve.fade };

export function scrolledPastTop(offset: number): boolean {
  return offset > 0;
}

export function useScrollEdge() {
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
  const theme = useTheme();
  return <Animated.View pointerEvents="none" style={{ height: SCROLL_EDGE.line, backgroundColor: theme.divider, opacity }} />;
}
