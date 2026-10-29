import { useEffect, useRef } from "react";
import { Animated, type ViewStyle } from "react-native";
import { useWindowId } from "../../state/browser/hooks";
import { useTabDrag } from "../../state/drag/tabDrag";
import { curve } from "../ui/motion";
import { useTheme } from "../ui/theme";
import { DROP_GLOW_MS, DROP_RING_WIDTH } from "./tokens";

export type DropGlowPlace = Pick<ViewStyle, "left" | "right" | "top" | "bottom" | "height" | "borderRadius">;

export function WindowDropGlow({ place }: { place: DropGlowPlace }) {
  const windowId = useWindowId();
  const theme = useTheme();
  const over = useTabDrag((d) => d.phase !== "idle" && d.overWindow === windowId);
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(glow, { toValue: over ? 1 : 0, duration: DROP_GLOW_MS, easing: curve.outQuad, useNativeDriver: true }).start();
  }, [over]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        ...place,
        borderWidth: DROP_RING_WIDTH,
        borderColor: theme.accent,
        backgroundColor: theme.dropZoneFill,
        opacity: glow,
      }}
    />
  );
}
