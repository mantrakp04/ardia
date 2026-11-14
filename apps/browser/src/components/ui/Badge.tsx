import { View, type StyleProp, type ViewStyle } from "react-native";
import { Text } from "./Text";
import { useTheme, type Theme } from "./theme";
import { capsule, font, hairline, lineHeight, space, tabularNums, weight as weights } from "./tokens";

export type BadgeTone = "neutral" | "accent" | "chip" | "now";

const BADGE_SIZE = {
  s: { height: 14, type: font.badge, line: lineHeight.badge, weight: weights.bold },
  m: { height: 18, type: font.tiny, line: lineHeight.tiny, weight: weights.semibold },
} as const;


function badgeLook(theme: Theme, tone: BadgeTone) {
  switch (tone) {
    case "accent":
      return { fill: theme.accent, ink: theme.onAccent };
    case "now":
      return { fill: theme.destructive, ink: theme.onAccent };
    case "chip":
      return { fill: theme.chipFill, ink: theme.textSecondary };
    default:
      return { fill: theme.badgeFill, ink: theme.textTab };
  }
}

export function Badge({
  text,
  tone = "neutral",
  size = "m",
  scale = 1,
  outline,
  ring,
  fill,
  color,
  style,
}: {
  text: string | number;
  tone?: BadgeTone;
  size?: "s" | "m";
  scale?: number;
  outline?: boolean;
  ring?: string;
  fill?: string;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const look = badgeLook(theme, tone);
  const metrics = BADGE_SIZE[size];
  const px = (value: number) => Math.round(value * scale * 2) / 2;
  const ink = color ?? (outline ? look.fill : look.ink);
  const shape: ViewStyle = {
    height: px(metrics.height),
    minWidth: px(metrics.height),
    borderRadius: capsule(px(metrics.height)),
    paddingHorizontal: px(space.xs),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: outline ? undefined : (fill ?? look.fill),
    borderWidth: outline ? hairline.panel : ring ? 1 : undefined,
    borderColor: outline ? ink : ring,
  };
  return (
    <View pointerEvents="none" style={style ? [shape, style] : shape}>
      <Text numberOfLines={1} style={{ ...metrics.type, fontSize: px(metrics.type.fontSize), lineHeight: px(metrics.line), fontWeight: metrics.weight, color: ink, ...tabularNums }}>
        {text}
      </Text>
    </View>
  );
}
