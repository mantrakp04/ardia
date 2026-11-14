import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";
import { capsule, Panel, radius, space, useTheme } from "../ui";
import { SHADOWS, windowColors } from "./tokens";

type HudShape = { shape: "capsule" | "tile"; height: number; children: ReactNode };

export function HudPlate({ shape, height, children, ...rest }: ViewProps & HudShape) {
  const colors = windowColors(useTheme().dark);
  return (
    <Panel {...rest} fill={colors.statusFill} border={colors.statusBorder} radius={shape === "capsule" ? capsule(height) : radius.tile} shadow={SHADOWS.status}>
      {children}
    </Panel>
  );
}

export function Hud({ shape, height, children, ...rest }: Omit<ViewProps, "style"> & HudShape) {
  return (
    <HudPlate shape={shape} height={height}>
      <View {...rest} style={{ height, flexDirection: "row", alignItems: "center", paddingHorizontal: shape === "capsule" ? undefined : space.m }}>
        {children}
      </View>
    </HudPlate>
  );
}
