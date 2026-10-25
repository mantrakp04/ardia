import { Surface } from "@ardia/shell";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Text } from "react-native";
import { hex, useTheme } from "../lib/theme";

const SHOW_DELAY_MS = 500;
const FADE_MS = 100;
const FADE_EASING = Easing.bezier(0.25, 0.46, 0.45, 0.94);
const SPAN = 280;
const RING = 0.5;
const RADIUS = 4;

function useShownAfterDelay(active: boolean) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [active]);
  return shown && active;
}

export function TooltipAbove({ text, active, centerX, bottom }: { text: string; active: boolean; centerX: number; bottom: number }) {
  const theme = useTheme();
  const shown = useShownAfterDelay(active && text.length > 0);
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!shown) {
      opacity.setValue(0);
      return;
    }
    const fade = Animated.timing(opacity, { toValue: 1, duration: FADE_MS, easing: FADE_EASING, useNativeDriver: true });
    fade.start();
    return () => fade.stop();
  }, [shown, opacity]);
  if (!shown) return null;
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", left: centerX - SPAN / 2, width: SPAN, bottom: bottom - RING, alignItems: "center", opacity }}>
      <Surface
        cornerRadius={RADIUS + RING}
        borderColor={hex(theme.dark ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.12)")}
        borderWidth={RING}
        shadowColor="#000000"
        shadowOpacity={theme.dark ? 0.15 : 0.08}
        shadowRadius={4}
        shadowOffset={[0, 1]}
        style={{ padding: RING }}
      >
        <Surface
          fill={hex(theme.dark ? "#262626" : theme.panel)}
          cornerRadius={RADIUS}
          borderColor={hex(theme.panelBorder)}
          borderWidth={1}
          style={{ paddingHorizontal: 6.5, paddingVertical: 5 }}
        >
          <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "500", color: theme.dark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.85)" }}>
            {text}
          </Text>
        </Surface>
      </Surface>
    </Animated.View>
  );
}
