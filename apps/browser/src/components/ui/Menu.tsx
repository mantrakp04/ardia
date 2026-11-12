import { Symbol } from "@ardia/shell";
import type { ReactNode } from "react";
import { Pressable, Text, View, type GestureResponderEvent } from "react-native";
import { Divider } from "./Divider";
import { GlassFill, useGlass } from "./Glass";
import { PANEL } from "./Popover";
import { useTheme, type Theme } from "./theme";
import { opacity, space } from "./tokens";
import { useHover } from "./useHover";

export const menuRowFill = (theme: Theme, pressed = false) => (pressed ? theme.popoverRowPressed : theme.rowHover);

const RING_WIDTH = 1.5;

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
  selected,
  minHeight = PANEL.rowHeight,
  ring,
  tooltip,
}: {
  icon?: string;
  leading?: ReactNode;
  iconColor?: string;
  title: string;
  detail?: string;
  accessory?: ReactNode;
  onPress?: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  destructive?: boolean;
  selected?: boolean;
  minHeight?: number;
  ring?: boolean;
  tooltip?: string;
}) {
  const theme = useTheme();
  const glass = useGlass();
  const { hovered, hoverProps } = useHover();
  const tint = destructive ? theme.destructive : theme.textPrimary;
  const content = (pressed: boolean) => {
    const lit = !!onPress && !disabled && (pressed || hovered);
    const fill = lit ? menuRowFill(theme, pressed) : selected ? theme.rowSelected : undefined;
    return (
      <View
        style={{
          minHeight,
          marginHorizontal: PANEL.rowInset,
          paddingHorizontal: PANEL.rowPadding,
          borderRadius: PANEL.rowRadius,
          flexDirection: "row",
          alignItems: "center",
          gap: PANEL.iconGap,
          opacity: disabled ? opacity.disabled : 1,
          backgroundColor: glass && lit ? undefined : fill,
          borderWidth: ring ? RING_WIDTH : undefined,
          borderColor: ring ? theme.accent : undefined,
        }}
      >
        {glass && lit ? <GlassFill radius={PANEL.rowRadius} state={pressed ? "pressed" : "lit"} /> : null}
        {leading ? (
          <View style={{ width: PANEL.iconSlot, height: PANEL.iconSlot, alignItems: "center", justifyContent: "center" }}>{leading}</View>
        ) : icon ? (
          <Symbol name={icon} size={PANEL.iconSize} color={iconColor ?? (destructive ? tint : theme.icon)} style={{ width: PANEL.iconSlot, height: PANEL.iconSlot }} />
        ) : null}
        <View style={{ flex: 1, paddingVertical: space.s }}>
          <Text numberOfLines={1} style={{ fontSize: PANEL.titleSize, color: tint }}>
            {title}
          </Text>
          {detail ? (
            <Text numberOfLines={2} style={{ fontSize: PANEL.subtitleSize, color: theme.textSecondary }}>
              {detail}
            </Text>
          ) : null}
        </View>
        {accessory}
      </View>
    );
  };
  if (!onPress)
    return (
      <View {...hoverProps} tooltip={tooltip}>
        {content(false)}
      </View>
    );
  return (
    <View {...hoverProps} tooltip={tooltip}>
      <Pressable onPress={onPress} disabled={disabled}>
        {({ pressed }) => content(pressed)}
      </Pressable>
    </View>
  );
}

const SEPARATOR = { marginVertical: PANEL.separatorGap } as const;

export function MenuSeparator() {
  return <Divider inset="xl" style={SEPARATOR} />;
}
