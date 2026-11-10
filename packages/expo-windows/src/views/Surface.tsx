import { forwardRef, type ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import { parseColor, rgbaString, sampleStops, type Rgba } from "./color";
import { colorOrUndefined, dropShadow, finite, useFirstWindow, type AnyProps } from "./shared";

function gradientBorderSides(colors: unknown): ViewStyle | null {
  if (!Array.isArray(colors) || colors.length < 2) return null;
  const stops = colors.map(parseColor).filter((stop): stop is Rgba => !!stop);
  if (stops.length < 2) return null;
  const middle = rgbaString(sampleStops(stops, 0.5));
  return { borderTopColor: rgbaString(stops[0]!), borderBottomColor: rgbaString(stops[stops.length - 1]!), borderLeftColor: middle, borderRightColor: middle };
}

export const Surface = forwardRef<View, AnyProps>(function Surface(
  { fill, cornerRadius, borderColor, borderWidth, borderColors, surfaceShadowColor, surfaceShadowOpacity, surfaceShadowRadius, surfaceShadowOffset, style, children, ...rest },
  ref,
) {
  useFirstWindow();
  const width = Math.max(0, finite(borderWidth, 0));
  const offset = Array.isArray(surfaceShadowOffset) ? surfaceShadowOffset : [0, 0];
  const gradient = width > 0 ? gradientBorderSides(borderColors) : null;
  const solid = width > 0 && !gradient ? colorOrUndefined(borderColor) : undefined;
  const surface: ViewStyle = {
    backgroundColor: colorOrUndefined(fill),
    borderRadius: Math.max(0, finite(cornerRadius, 0)),
    ...(gradient ? { borderWidth: width, ...gradient } : solid ? { borderWidth: width, borderColor: solid } : null),
    ...dropShadow(surfaceShadowColor, surfaceShadowOpacity, surfaceShadowRadius, offset[0], offset[1]),
  };
  return (
    <View {...rest} ref={ref} style={[surface, style as ViewStyle]}>
      {children as ReactNode}
    </View>
  );
});
