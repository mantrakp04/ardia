import { Surface } from "@ardia/shell";
import { useEffect, useRef, useState } from "react";
import { Animated, Text } from "react-native";
import { hex, useTheme } from "./theme";
import { font, hairline, shadow, TOOLTIP, weight } from "./tokens";
import { curve, duration } from "./motion";

const SHOW_DELAY_MS = 500;
const FADE_MS = duration.fast;
const FADE_EASING = curve.fade;
const SPAN = 280;
const RING = hairline.ring;
const RADIUS = TOOLTIP.radius;

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
        borderColor={hex(theme.tooltipRing)}
        borderWidth={RING}
        shadowColor={shadow.tooltip.color}
        shadowOpacity={theme.dark ? shadow.tooltip.opacity.dark : shadow.tooltip.opacity.light}
        shadowRadius={shadow.tooltip.radius}
        shadowOffset={shadow.tooltip.offset}
        style={{ padding: RING }}
      >
        <Surface
          fill={hex(theme.tooltipFill)}
          cornerRadius={RADIUS}
          borderColor={hex(theme.panelBorder)}
          borderWidth={1}
          style={{ paddingHorizontal: TOOLTIP.padX, paddingVertical: TOOLTIP.padY }}
        >
          <Text numberOfLines={1} style={{ ...font.small, fontWeight: weight.medium, color: theme.tooltipText }}>
            {text}
          </Text>
        </Surface>
      </Surface>
    </Animated.View>
  );
}
