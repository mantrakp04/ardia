import { StyleSheet, View } from "react-native";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { font, radius, space, weight, withAlpha } from "./tokens";

const KEY_CAP = { height: 24, minWidth: 38, editingRing: 1.5, editingFill: 0.2 } as const;

export function KeyCap({ keys, editing = false, empty = false, hovered = false, scale = 1 }: { keys: string[]; editing?: boolean; empty?: boolean; hovered?: boolean; scale?: number }) {
  const theme = useTheme();
  return (
    <View
      style={{
        minWidth: KEY_CAP.minWidth * scale,
        height: KEY_CAP.height * scale,
        paddingHorizontal: space.m * scale,
        borderRadius: radius.control * scale,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: editing ? withAlpha(theme.formAccent, KEY_CAP.editingFill) : hovered ? theme.controlHover : theme.control,
        borderWidth: editing ? KEY_CAP.editingRing : StyleSheet.hairlineWidth * 2,
        borderColor: editing ? theme.formAccent : theme.controlBorder,
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: font.small.fontSize * scale, fontWeight: weight.medium, color: editing ? theme.formAccent : empty ? theme.textTertiary : theme.textPrimary }}>
        {keys.join("")}
      </Text>
    </View>
  );
}
