import { Surface } from "@ardia/shell";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import { hex, useTheme } from "./theme";
import { hairline, radius, shadow, space, type Space } from "./tokens";

const CENTERED: StyleProp<ViewStyle> = [StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }];

export function Dialog({
  width,
  pad = "xxl",
  onDismiss,
  maxHeight,
  place,
  children,
}: {
  width: number;
  pad?: Space;
  onDismiss: () => void;
  maxHeight?: DimensionValue;
  place?: Pick<ViewStyle, "top" | "left" | "right" | "bottom">;
  children: ReactNode;
}) {
  const theme = useTheme();
  const level = shadow.dialog;
  const surface = (
    <Surface
      fill={hex(theme.panel)}
      cornerRadius={radius.sheet}
      borderColor={hex(theme.panelBorder)}
      borderWidth={hairline.panel}
      shadowColor={level.color}
      shadowOpacity={theme.panelShadowOpacity}
      shadowRadius={level.radius}
      shadowOffset={level.offset}
      style={place ? { position: "absolute", ...place, width, padding: space[pad] } : { width, maxHeight, padding: space[pad] }}
    >
      {children}
    </Surface>
  );
  if (place)
    return (
      <View style={StyleSheet.absoluteFill}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
        {surface}
      </View>
    );
  return (
    <View style={CENTERED}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }]} onPress={onDismiss} />
      {surface}
    </View>
  );
}

export function Sheet({ width = 440, onClose, children }: { width?: number; onClose: () => void; children: ReactNode }) {
  return (
    <Dialog width={width} maxHeight="90%" onDismiss={onClose}>
      {children}
    </Dialog>
  );
}
