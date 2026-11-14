import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

export function Shade({ shaded, children }: { shaded: boolean; children: ReactNode }) {
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
      collapsable={false}
      importantForAccessibility={shaded ? "no-hide-descendants" : "auto"}
      accessibilityElementsHidden={shaded}
    >
      {children}
    </View>
  );
}
