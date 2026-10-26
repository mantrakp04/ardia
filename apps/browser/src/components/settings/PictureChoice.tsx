import type { ReactNode } from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { font, Symbol, useTheme } from "../ui";

const CHECK = { width: 14, height: 14 } as const;
const CAPTION = { flexDirection: "row", alignItems: "center", gap: 5 } as const;

export function PictureChoice({
  title,
  selected,
  onPress,
  tooltip,
  gap,
  frame,
  children,
}: {
  title: string;
  selected: boolean;
  onPress: () => void;
  tooltip?: string;
  gap: number;
  frame: ViewStyle;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={{ flex: 1, alignItems: "center", gap }} tooltip={tooltip}>
      <View style={[{ width: "100%", borderWidth: selected ? 2.5 : 1, borderColor: selected ? theme.formAccent : theme.groupBorder }, frame]}>{children}</View>
      <View style={CAPTION}>
        {selected && <Symbol name="checkmark.circle.fill" size={12} color={theme.formAccent} style={CHECK} />}
        <Text style={{ ...font.small, color: selected ? theme.textPrimary : theme.textSecondary }}>{title}</Text>
      </View>
    </Pressable>
  );
}
