import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { rgbaString, sampleStops, type Rgba } from "./color";

type BandsProps = { stops: Rgba[]; angle?: number; count?: number; opacity?: number; borderRadius?: number };

export const Bands = memo(function Bands({ stops, angle = 180, count = 16, opacity, borderRadius }: BandsProps) {
  if (stops.length === 0) return null;
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
