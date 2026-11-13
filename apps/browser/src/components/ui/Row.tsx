import { useInterfaceMetrics, scaleInterfaceStyle } from "./interfaceSize";
import { scaleMetrics } from "../../lib/interfaceMetrics";
import { Symbol as Symbol, RawText as Text } from "./ScaledNative";
import { useMemo } from "react";

import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Divider } from "./Divider";
import { useTheme } from "./theme";
import { lineHeight, radius, space, font as typeScale } from "./tokens";
import { useHover } from "./useHover";

export function Row({ title, description, children, icon, onPress }: { title?: ReactNode; description?: ReactNode; children?: ReactNode; icon?: ReactNode; onPress?: () => void }) {
  const interfaceScale = useInterfaceMetrics().factor;
  const { space } = useMemo(() => ({ space: scaleMetrics(BASE_INTERFACE_METRICS.space, interfaceScale) }), [interfaceScale]);
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const body = (
    <View
      style={{
        minHeight: 40 * interfaceScale,
        paddingHorizontal: space.l,
        paddingVertical: space.m,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: space.l,
        backgroundColor: onPress && hovered ? theme.rowHover : undefined,
      }}
    >
      {icon}
      <View style={{ flex: 1 }}>
        {typeof title === "string" ? <Text style={{ ...typeScale.body, color: theme.textPrimary }}>{title}</Text> : title}
        {description ? (
          typeof description === "string" ? (
            <Text style={{ ...typeScale.caption, marginTop: space.xxs, color: theme.textSecondary, lineHeight: lineHeight.caption }}>{description}</Text>
          ) : (
            description
          )
        ) : null}
      </View>
      {children}
      {onPress && <Symbol name="chevron.right" size={11} weight="semibold" color={theme.textTertiary} style={{ width: 12 * interfaceScale, height: 14 * interfaceScale }} />}
    </View>
  );
  if (!onPress) return body;
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress}>{body}</Pressable>
    </View>
  );
}

export function Group({ children }: { children: ReactNode }) {
  const interfaceScale = useInterfaceMetrics().factor;
  const { radius } = useMemo(() => ({ radius: scaleMetrics(BASE_INTERFACE_METRICS.radius, interfaceScale) }), [interfaceScale]);
  const theme = useTheme();
  const rows = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean);
  return (
    <View style={{ borderRadius: radius.panel, backgroundColor: theme.groupFill, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: theme.groupBorder, overflow: "hidden" }}>
      {rows.map((row, i) => (
        <View key={i}>
          {i > 0 && <Divider thick inset="l" />}
          {row}
        </View>
      ))}
    </View>
  );
}

const BASE_INTERFACE_METRICS = { space, radius };
