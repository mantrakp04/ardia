import { memo } from "react";
import { StyleSheet, View } from "react-native";

const AMBER = "#F5C52A";
const GAP = "#141414";

export const developerSubtitle = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

export const DeveloperRowBorder = memo(function DeveloperRowBorder() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: 10, borderWidth: 2, borderColor: GAP }]} />
      <View style={[StyleSheet.absoluteFill, { borderRadius: 10, borderWidth: 2, borderColor: AMBER, borderStyle: "dashed" }]} />
    </View>
  );
});
