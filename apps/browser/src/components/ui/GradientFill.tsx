import { useMemo } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { Surface } from "@ardia/shell";
import { parseColor, toHex } from "../../lib/color";

export type GradientStop = readonly [at: number, alpha: number];

export function GradientFill({ color, stops, fade, style }: { color: string; stops: readonly GradientStop[]; fade?: readonly GradientStop[]; style?: StyleProp<ViewStyle> }) {
  const [colors, places] = useMemo(() => {
    const [r, g, b, a] = parseColor(color);
    return [stops.map(([, alpha]) => toHex([r, g, b, a * alpha * 255])), stops.map(([at]) => at)];
  }, [color, stops]);
  const [alphas, alphaPlaces] = useMemo(() => [fade?.map(([, alpha]) => alpha), fade?.map(([at]) => at)], [fade]);
  return <Surface pointerEvents="none" fillColors={colors} fillStops={places} fade={alphas} fadeStops={alphaPlaces} style={style} />;
}
