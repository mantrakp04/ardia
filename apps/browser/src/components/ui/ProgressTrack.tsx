import { Animated, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "./theme";
import { capsule, type ColorRole } from "./tokens";

export function ProgressTrack({
  value,
  height = 3,
  tone = "accent",
  color,
  track = true,
  style,
}: {
  value: number | Animated.Value;
  height?: number;
  tone?: ColorRole;
  color?: string;
  track?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const width = typeof value === "number" ? `${Math.min(1, Math.max(0, value)) * 100}%` : value.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });
  const ends = capsule(height);
  return (
    <View style={[{ height, borderRadius: ends, backgroundColor: track ? theme.progressTrack : undefined, overflow: "hidden" }, style]}>
      <Animated.View style={{ width: width as `${number}%`, height, borderRadius: ends, backgroundColor: color ?? theme[tone] }} />
    </View>
  );
}
