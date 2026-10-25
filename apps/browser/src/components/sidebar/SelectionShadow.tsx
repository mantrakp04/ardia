import { Surface } from "@ardia/shell";
import { createContext, useContext } from "react";
import { Animated, StyleSheet } from "react-native";
import { hex, useTheme } from "../../lib/theme";

export const SelectionShadowOpacityContext = createContext<Animated.AnimatedInterpolation<number> | number>(1);

export function SelectionShadow() {
  const opacity = useContext(SelectionShadowOpacityContext);
  const theme = useTheme();
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
      <Surface
        cornerRadius={10}
        shadowColor={hex(theme.tabSelectedShadow)}
        shadowOpacity={1}
        shadowRadius={theme.tabSelectedShadowRadius}
        shadowOffset={[0, 0.5]}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}
