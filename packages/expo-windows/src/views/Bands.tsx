import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { rgbaString, sampleStops, type Rgba } from "./color";
import { NativeMaterialGradient, nativeGradient, type GradientSpan } from "./nativeMaterials";

type BandsProps = { stops: Rgba[]; angle?: number; count?: number; opacity?: number; borderRadius?: number; span?: GradientSpan; reach?: number };

export function gradientColors(stops: Rgba[], count: number): number[] {
  if (stops.length === 0) return [];
  if (stops.length === 1) return [...stops[0]!];
  const steps = Math.max(2, Math.round(count));
  const colors: number[] = [];
  for (let i = 0; i < steps; i++) colors.push(...sampleStops(stops, i / (steps - 1)));
  return colors;
}

const StripBands = memo(function StripBands({ stops, angle = 180, count = 16, opacity, borderRadius }: BandsProps) {
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const vertical = Math.abs(dy) >= Math.abs(dx);
  const reversed = vertical ? dy < 0 : dx < 0;
  const steps = stops.length === 1 ? 1 : Math.max(2, Math.round(count));
  const bands = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    bands.push(<View key={i} style={{ flex: 1, backgroundColor: rgbaString(sampleStops(stops, reversed ? 1 - t : t)) }} />);
  }
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { flexDirection: vertical ? "column" : "row", opacity, borderRadius, overflow: borderRadius ? "hidden" : undefined }]}
    >
      {bands}
    </View>
  );
});

export const Bands = memo(function Bands(props: BandsProps) {
  const { stops, angle = 180, count = 16, opacity, borderRadius, span = "unit", reach = 1 } = props;
  if (stops.length === 0) return null;
  if (!nativeGradient()) return <StripBands {...props} />;
  const gradient = <NativeMaterialGradient pointerEvents="none" colors={gradientColors(stops, count)} angle={angle} span={span} reach={reach} style={StyleSheet.absoluteFill} />;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity, borderRadius, overflow: borderRadius ? "hidden" : undefined }]}>
      {gradient}
    </View>
  );
});
