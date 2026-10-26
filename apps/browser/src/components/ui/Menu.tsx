import { Symbol } from "@ardia/shell";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { PANEL } from "./Popover";
import { useTheme, type Theme } from "./theme";
import { opacity } from "./tokens";
import { useHover } from "./useHover";

export const menuRowFill = (theme: Theme, pressed = false) => (pressed ? theme.popoverRowPressed : theme.rowHover);

export function MenuRow({
  icon,
  leading,
  iconColor,
  title,
  detail,
  accessory,
  onPress,
  disabled,
  destructive,
}: {
  icon?: string;
  leading?: ReactNode;
  iconColor?: string;
  title: string;
  detail?: string;
  accessory?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const tint = destructive ? theme.destructive : theme.textPrimary;
  const content = (pressed: boolean) => (
    <View
      style={{
        minHeight: PANEL.rowHeight,
        marginHorizontal: PANEL.rowInset,
        paddingHorizontal: PANEL.rowPadding,
        borderRadius: PANEL.rowRadius,
        flexDirection: "row",
        alignItems: "center",
        gap: PANEL.iconGap,
        opacity: disabled ? opacity.disabled : 1,
        backgroundColor: onPress && !disabled && (pressed || hovered) ? menuRowFill(theme, pressed) : undefined,
      }}
    >
      {leading ? (
        <View style={{ width: PANEL.iconSlot, height: PANEL.iconSlot, alignItems: "center", justifyContent: "center" }}>{leading}</View>
      ) : icon ? (
        <Symbol name={icon} size={PANEL.iconSize} color={iconColor ?? (destructive ? tint : theme.icon)} style={{ width: PANEL.iconSlot, height: PANEL.iconSlot }} />
      ) : null}
      <View style={{ flex: 1, paddingVertical: 6 }}>
        <Text numberOfLines={1} style={{ fontSize: PANEL.titleSize, color: tint }}>
          {title}
        </Text>
        {detail ? (
          <Text numberOfLines={2} style={{ fontSize: PANEL.subtitleSize, color: theme.textSecondary, marginTop: 1 }}>
            {detail}
          </Text>
        ) : null}
      </View>
      {accessory}
    </View>
  );
  if (!onPress) return <View {...hoverProps}>{content(false)}</View>;
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress} disabled={disabled}>
        {({ pressed }) => content(pressed)}
      </Pressable>
    </View>
  );
}

export function MenuSeparator() {
  const theme = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, marginVertical: PANEL.separatorGap, marginHorizontal: PANEL.inset, backgroundColor: theme.divider }} />;
}
