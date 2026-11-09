import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "../ui/theme";
import { GlassFill, useGlass } from "../ui/Glass";
import { SIDEBAR_FIELD } from "./geometry";

const FIELD_BORDER = StyleSheet.hairlineWidth;

export const SidebarFieldFill = memo(function SidebarFieldFill({
  hovered,
}: {
  hovered: boolean;
}) {
  const theme = useTheme();
  if (useGlass()) {
    return (
      <GlassFill state={hovered ? "lit" : "rest"} radius={SIDEBAR_FIELD.radius} />
    );
  }
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          borderRadius: SIDEBAR_FIELD.radius,
          borderWidth: FIELD_BORDER,
          borderColor: theme.pinnedRestingStroke,
          backgroundColor: hovered ? theme.tabHover : theme.pinnedResting,
        },
      ]}
    />
  );
});
