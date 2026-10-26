import type { ReactNode } from "react";
import { View } from "react-native";
import { swatch } from "./tokens";

const RING = { width: swatch.size, height: swatch.size, borderRadius: swatch.size / 2, padding: swatch.inset, borderWidth: swatch.ring } as const;
const DISC = { flex: 1, borderRadius: swatch.size / 2 - swatch.inset, overflow: "hidden" } as const;

export function Swatch({ selected, ring, fill, children }: { selected: boolean; ring: string; fill?: string; children?: ReactNode }) {
  return (
    <View style={[RING, { borderColor: selected ? ring : "transparent" }]}>
      <View style={[DISC, { backgroundColor: fill }]}>{children}</View>
    </View>
  );
}
