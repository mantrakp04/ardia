import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { radius as radii, useHover, useTheme, type Radius } from "../ui";
import { selectableCard } from "./tokens";
import { useSettingsColors } from "./useSettingsColors";

export function SelectableCard({
  selected,
  hovered: hoveredFromParent,
  onPress,
  tooltip,
  dashed,
  fill = true,
  radius = "panel",
  style,
  children,
}: {
  selected: boolean;
  hovered?: boolean;
  onPress?: () => void;
  tooltip?: string;
  dashed?: boolean;
  fill?: boolean;
  radius?: Radius;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const theme = useTheme();
  const look = useSettingsColors();
  const { hovered: hoveredHere, hoverProps } = useHover();
  const hovered = onPress ? hoveredHere : !!hoveredFromParent;
  const backgroundColor = selected
    ? fill
      ? `${theme.formAccent}${selectableCard.selectedAlpha}`
      : undefined
    : hovered
      ? theme.rowHover
      : fill && !dashed
        ? theme.groupFill
        : undefined;
  const card = (
    <View
      style={[
        {
          borderRadius: radii[radius],
          borderWidth: selected || dashed ? selectableCard.selectedBorder : StyleSheet.hairlineWidth * 2,
          borderStyle: dashed ? "dashed" : "solid",
          borderColor: selected ? theme.formAccent : dashed ? look.dashedBorder : theme.groupBorder,
          backgroundColor,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
  if (!onPress) return card;
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress} tooltip={tooltip}>
        {card}
      </Pressable>
    </View>
  );
}
