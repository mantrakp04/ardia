import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { Button, type IconPalette } from "../ui";
import { useTheme } from "../ui/theme";
import { GlassFill, useGlass } from "../ui/Glass";
import { SIDEBAR_FIELD } from "./geometry";
import { useSidebarTokens } from "./tokens";

const FIELD_BORDER = StyleSheet.hairlineWidth;
export const FIELD_BUTTON = {
  box: 24,
  inset: (SIDEBAR_FIELD.height - 24) / 2,
  radius: SIDEBAR_FIELD.radius - (SIDEBAR_FIELD.height - 24) / 2,
} as const;

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

export function FieldSiteButton({
  icon,
  color,
  tooltip,
  active,
  palette,
  onPress,
}: {
  icon: string;
  color?: string;
  tooltip: string;
  active: boolean;
  palette: IconPalette;
  onPress: () => void;
}) {
  const tokens = useSidebarTokens();
  return (
    <View
      style={{
        marginLeft: FIELD_BUTTON.inset,
        width: FIELD_BUTTON.box,
        height: FIELD_BUTTON.box,
        borderRadius: FIELD_BUTTON.radius,
        backgroundColor: tokens.fieldButtonPlate,
      }}
    >
      <Button
        variant="icon"
        toolbar
        palette={palette}
        icon={icon}
        color={color}
        size={12}
        box={FIELD_BUTTON.box}
        radius={FIELD_BUTTON.radius}
        active={active}
        onPress={onPress}
        tooltip={tooltip}
      />
    </View>
  );
}
