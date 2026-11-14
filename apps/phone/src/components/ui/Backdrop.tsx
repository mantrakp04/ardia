import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { linearGradientCss } from "../../lib/gradient";

export function Backdrop({ colors, diagonal = false }: { colors: readonly string[]; diagonal?: boolean }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  return (
    <View
      pointerEvents="none"
      onLayout={diagonal ? (event) => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height }) : undefined}
      style={[StyleSheet.absoluteFill, { experimental_backgroundImage: linearGradientCss(colors, diagonal, size.width, size.height) }]}
    />
  );
}
