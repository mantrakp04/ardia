import { useInterfaceMetrics, scaleInterfaceStyle } from "../ui/interfaceSize";
import { scaleMetrics } from "../../lib/interfaceMetrics";
import { useMemo } from "react";
import { memo, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { FadeLabel, font, radius, Surface, type SurfaceProps } from "../ui";
import { hex, layout, useTheme } from "../ui/theme";
import { useSelectedTabGlow } from "./rowLook";
import { SELECTED_ROW_SHADOW_OFFSET, SIDEBAR_TYPE, TAB_ROW } from "./tokens";

export const ROW_TITLE_FRAME = { flex: 1, height: TAB_ROW.titleHeight, marginLeft: TAB_ROW.titleGap } as const;

const COMPACT_TITLE_FRAME = { flex: 1, height: TAB_ROW.compactTitleHeight, marginLeft: TAB_ROW.titleGap } as const;

export function SidebarRowSurface({
  fill,
  selected = false,
  border = 0,
  stroke,
  cornerRadius = radius.chrome,
  padLeft = TAB_ROW.contentLeft,
  padRight = TAB_ROW.trailing,
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
  const interfaceScale = useInterfaceMetrics().factor;
  const { SELECTED_ROW_SHADOW_OFFSET, layout } = useMemo(() => ({ SELECTED_ROW_SHADOW_OFFSET: scaleMetrics(BASE_INTERFACE_METRICS.SELECTED_ROW_SHADOW_OFFSET, interfaceScale), layout: scaleMetrics(BASE_INTERFACE_METRICS.layout, interfaceScale) }), [interfaceScale]);
  const theme = useTheme();
  const glow = useSelectedTabGlow();
  return (
    <Surface
      fill={hex(fill)}
      cornerRadius={cornerRadius}
      borderWidth={border}
      borderColor={stroke === undefined ? undefined : hex(stroke)}
      borderColors={selected ? theme.tabSelectedBorder.map(hex) : undefined}
      shadowColor={selected ? glow.shadowColor : undefined}
      shadowOpacity={selected ? glow.shadowOpacity : 0}
      shadowRadius={glow.shadowRadius}
      shadowOffset={SELECTED_ROW_SHADOW_OFFSET}
      style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: padLeft, paddingRight: padRight }}
    >
      {children}
    </Surface>
  );
}

export const SidebarRowLabel = memo(function SidebarRowLabel({ text, color, weight, compact = false }: { text: string; color: string; weight?: "medium" | "regular"; compact?: boolean }) {
  const interfaceScale = useInterfaceMetrics().factor;
  const { SIDEBAR_TYPE, COMPACT_TITLE_FRAME, ROW_TITLE_FRAME } = useMemo(() => ({ SIDEBAR_TYPE: BASE_INTERFACE_METRICS.SIDEBAR_TYPE, COMPACT_TITLE_FRAME: scaleInterfaceStyle(BASE_INTERFACE_METRICS.COMPACT_TITLE_FRAME, interfaceScale), ROW_TITLE_FRAME: scaleInterfaceStyle(BASE_INTERFACE_METRICS.ROW_TITLE_FRAME, interfaceScale) }), [interfaceScale]);
  return <FadeLabel text={text} fontSize={compact ? BASE_INTERFACE_METRICS.SIDEBAR_TYPE.compact : font.body.fontSize} weight={weight} color={color} style={compact ? COMPACT_TITLE_FRAME : ROW_TITLE_FRAME} />;
});

export function SidebarListRow({ height, fill, padRight = 0, style, children }: { height: number; fill?: string; padRight?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const interfaceScale = useInterfaceMetrics().factor;
  const { radius, TAB_ROW } = useMemo(() => ({ radius: scaleMetrics(BASE_INTERFACE_METRICS.radius, interfaceScale), TAB_ROW: scaleMetrics(BASE_INTERFACE_METRICS.TAB_ROW, interfaceScale) }), [interfaceScale]);
  return (
    <View
      style={[
        { height, borderRadius: radius.tile, flexDirection: "row", alignItems: "center", paddingLeft: TAB_ROW.contentLeft, paddingRight: padRight, backgroundColor: fill },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const BASE_INTERFACE_METRICS = { SELECTED_ROW_SHADOW_OFFSET, layout, SIDEBAR_TYPE, COMPACT_TITLE_FRAME, ROW_TITLE_FRAME, radius, TAB_ROW };
