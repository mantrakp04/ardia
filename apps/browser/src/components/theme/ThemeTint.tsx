import { StyleSheet, View } from "react-native";

const BANDS = 32;

export function ThemeTint({ colors, accent }: { colors: readonly [string, string]; accent: string | null }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors[0] }]}>
      <View style={{ flex: 1 }}>
        {Array.from({ length: BANDS }, (_, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: colors[1], opacity: i / (BANDS - 1) }} />
        ))}
      </View>
      {accent ? <View style={[StyleSheet.absoluteFill, { backgroundColor: accent, opacity: 0.08 }]} /> : null}
    </View>
  );
}
