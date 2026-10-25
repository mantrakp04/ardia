import { WindowBackdrop } from "@ardia/shaders";
import { StyleSheet, View } from "react-native";

export function ThemeTint({ colors, accent }: { colors: readonly [string, string]; accent: string | null }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <WindowBackdrop colors={[colors[0], colors[1]]} grainOpacity={0} style={StyleSheet.absoluteFill} />
      {accent ? <View style={[StyleSheet.absoluteFill, { backgroundColor: accent, opacity: 0.08 }]} /> : null}
    </View>
  );
}
