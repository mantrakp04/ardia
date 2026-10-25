import { Symbol } from "@ardia/shell";
import { Text, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../../lib/theme";
import { classifyIcon } from "./classify";

type Props = {
  icon: string | null | undefined;
  size?: number;
  color?: string;
  weight?: "light" | "regular" | "medium" | "semibold" | "bold";
  monochrome?: boolean;
  initial?: string;
  style?: StyleProp<ViewStyle>;
};

export function IconGlyph({ icon, size = 16, color, weight = "medium", monochrome = false, initial, style }: Props) {
  const theme = useTheme();
  const ink = color ?? theme.icon;
  const classified = classifyIcon(icon);
  if (classified.kind === "symbol") {
    return <Symbol name={classified.name} size={size - 3} weight={weight} color={ink} style={[{ width: size, height: size }, style]} />;
  }
  if (classified.kind === "emoji") {
    if (monochrome) return <Symbol name="" emoji={classified.text} size={size - 1} color={ink} style={[{ width: size, height: size }, style]} />;
    return <Text style={[{ fontSize: size - 1, lineHeight: size + 2, textAlign: "center" }, style]}>{classified.text}</Text>;
  }
  if (classified.kind === "glyph") {
    return <Text style={[{ fontSize: size - 1, lineHeight: size + 1, fontWeight: "500", color: ink, textAlign: "center" }, style]}>{classified.text}</Text>;
  }
  if (classified.kind === "text") {
    return (
      <Text numberOfLines={1} style={[{ fontSize: size - 5, fontWeight: "500", color: ink, textAlign: "center" }, style]}>
        {classified.text.slice(0, 2)}
      </Text>
    );
  }
  return initial ? <Text style={[{ fontSize: size - 4, fontWeight: "600", color: ink, textAlign: "center" }, style]}>{initial}</Text> : null;
}
