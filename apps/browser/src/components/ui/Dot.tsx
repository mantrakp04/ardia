import type { ReactNode } from "react";
import { Animated, type StyleProp, type ViewStyle } from "react-native";
import { capsule } from "./tokens";

export function Dot({
  size,
  color,
  ring,
  ringWidth = 1,
  children,
  style,
}: {
  size: number;
  color: string;
  ring?: string;
  ringWidth?: number;
  children?: ReactNode;
  style?: StyleProp<ViewStyle> | Animated.WithAnimatedValue<StyleProp<ViewStyle>>;
}) {
  const shape: ViewStyle = {
    width: size,
    height: size,
    borderRadius: capsule(size),
    backgroundColor: color,
    borderWidth: ring ? ringWidth : undefined,
    borderColor: ring,
    alignItems: children ? "center" : undefined,
    justifyContent: children ? "center" : undefined,
  };
  return <Animated.View style={style ? [shape, style] : shape}>{children}</Animated.View>;
}
