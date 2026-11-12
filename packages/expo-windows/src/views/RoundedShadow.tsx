import { View } from "react-native";
import { shadowLayers, type Edges, type ShadowSpec } from "./shadowLayers";

export function RoundedShadow({ spec, cornerRadius, around }: { spec: ShadowSpec; cornerRadius: number; around?: Edges }) {
  return (
    <>
      {shadowLayers(spec, cornerRadius, around).map((layer, index) => (
        <View key={index} pointerEvents="none" style={layer} />
      ))}
    </>
  );
}
