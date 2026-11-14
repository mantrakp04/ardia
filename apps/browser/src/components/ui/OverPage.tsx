import { Surface } from "@ardia/shell";
import { StyleSheet } from "react-native";

export function OverPage({ radius }: { radius: number }) {
  return <Surface pointerEvents="none" cornerRadius={radius} style={StyleSheet.absoluteFill} />;
}
