import { Symbol } from "@ardia/shell";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "./theme";
import { radius, space, font as typeScale } from "./tokens";
import { useHover } from "./useHover";

export function Row({ title, description, children, icon, onPress }: { title?: ReactNode; description?: ReactNode; children?: ReactNode; icon?: ReactNode; onPress?: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const body = (
    <View
      style={{
        minHeight: 40,
        paddingHorizontal: space.l,
        paddingVertical: 9,
        flexDirection: "row",
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
            <Text style={{ ...typeScale.footnote, marginTop: space.xxs, color: theme.textSecondary, lineHeight: 15 }}>{description}</Text>
          ) : (
            description
          )
        ) : null}
      </View>
      {children}
      {onPress && <Symbol name="chevron.right" size={11} weight="semibold" color={theme.textTertiary} style={{ width: 12, height: 14 }} />}
    </View>
  );
  if (!onPress) return body;
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress}>{body}</Pressable>
    </View>
  );
}

export function Group({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const rows = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean);
  return (
    <View
      style={[
        { borderRadius: radius.card, backgroundColor: theme.groupFill, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: theme.groupBorder, overflow: "hidden" },
        style,
      ]}
    >
      {rows.map((row, i) => (
        <View key={i}>
          {i > 0 && <View style={{ height: StyleSheet.hairlineWidth * 2, marginHorizontal: space.l, backgroundColor: theme.divider }} />}
          {row}
        </View>
      ))}
    </View>
  );
}
