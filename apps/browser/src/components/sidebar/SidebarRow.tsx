import { memo, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { FadeLabel, Surface, type SurfaceProps } from "../ui";
import { hex, useTheme } from "../ui/theme";
import { useSelectedTabGlow } from "./rowLook";
import { useSidebarScale } from "./scale";
import { SELECTED_ROW_SHADOW_OFFSET } from "./tokens";

export function SidebarRowSurface({
  fill,
  selected = false,
  border = 0,
  stroke,
  cornerRadius,
  padLeft,
  padRight,
  children,
}: {
  fill: string;
  selected?: boolean;
  border?: number;
  stroke?: string;
  cornerRadius?: number;
  padLeft?: number;
  padRight?: number;
  children: SurfaceProps["children"];
}) {
  const theme = useTheme();
  const glow = useSelectedTabGlow();
  const m = useSidebarScale();
  return (
    <Surface
      fill={hex(fill)}
      cornerRadius={cornerRadius ?? m.radius.chrome}
      borderWidth={border}
      borderColor={stroke === undefined ? undefined : hex(stroke)}
      borderColors={selected ? theme.tabSelectedBorder.map(hex) : undefined}
      shadowColor={selected ? glow.shadowColor : undefined}
      shadowOpacity={selected ? glow.shadowOpacity : 0}
      shadowRadius={glow.shadowRadius}
      shadowOffset={SELECTED_ROW_SHADOW_OFFSET}
      style={{ height: m.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: padLeft ?? m.tabRow.contentLeft, paddingRight: padRight ?? m.tabRow.trailing }}
    >
      {children}
    </Surface>
  );
}

export const SidebarRowLabel = memo(function SidebarRowLabel({ text, color, weight, compact = false }: { text: string; color: string; weight?: "medium" | "regular"; compact?: boolean }) {
  const m = useSidebarScale();
  return <FadeLabel text={text} fontSize={compact ? m.font.compact : m.font.body} weight={weight} color={color} style={compact ? m.compactTitleFrame : m.titleFrame} />;
});

export function SidebarListRow({ height, fill, padRight = 0, style, children }: { height: number; fill?: string; padRight?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const m = useSidebarScale();
  return (
    <View
      style={[
        { height, borderRadius: m.radius.tile, flexDirection: "row", alignItems: "center", paddingLeft: m.tabRow.contentLeft, paddingRight: padRight, backgroundColor: fill },
        style,
      ]}
    >
      {children}
    </View>
  );
}
