import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";
import { capsule, Panel, radius, space, useTheme } from "../ui";
import { SHADOWS, windowColors } from "./tokens";

export function Hud({ shape, height, children, ...rest }: Omit<ViewProps, "style"> & { shape: "capsule" | "tile"; height: number; children: ReactNode }) {
  const colors = windowColors(useTheme().dark);
  return (
    <Panel fill={colors.statusFill} border={colors.statusBorder} radius={shape === "capsule" ? capsule(height) : radius.tile} shadow={SHADOWS.status}>
      <View {...rest} style={{ height, flexDirection: "row", alignItems: "center", paddingHorizontal: shape === "capsule" ? undefined : space.m }}>
        {children}
      </View>
    </Panel>
  );
}
