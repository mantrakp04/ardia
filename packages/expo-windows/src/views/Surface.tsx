import { forwardRef, type ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import { usePageCover } from "../engine/usePageCover";
import { parseColor, rgbaString, sampleStops, type Rgba } from "./color";
import { RoundedShadow } from "./RoundedShadow";
import { shadowSpec } from "./shadowLayers";
import { colorOrUndefined, finite, useFirstWindow, type AnyProps } from "./shared";

function gradientBorderSides(colors: unknown): ViewStyle | null {
  if (!Array.isArray(colors) || colors.length < 2) return null;
  const stops = colors.map(parseColor).filter((stop): stop is Rgba => !!stop);
  if (stops.length < 2) return null;
  const middle = rgbaString(sampleStops(stops, 0.5));
  return { borderTopColor: rgbaString(stops[0]!), borderBottomColor: rgbaString(stops[stops.length - 1]!), borderLeftColor: middle, borderRightColor: middle };
}

const CLEAR_BORDER = "rgba(0,0,0,0)";

export const Surface = forwardRef<View, AnyProps>(function Surface(
  { fill, cornerRadius, borderColor, borderWidth, borderColors, surfaceShadowColor, surfaceShadowOpacity, surfaceShadowRadius, surfaceShadowOffset, style, onLayout, children, ...rest },
  ref,
) {
  useFirstWindow();
  const corner = Math.max(0, finite(cornerRadius, 0));
  const cover = usePageCover(ref, onLayout, corner);
  const width = Math.max(0, finite(borderWidth, 0));
  const offset = Array.isArray(surfaceShadowOffset) ? surfaceShadowOffset : [0, 0];
  const gradient = width > 0 ? gradientBorderSides(borderColors) : null;
  const solid = width > 0 && !gradient ? colorOrUndefined(borderColor) : undefined;
  const border: ViewStyle | null = gradient ? { borderWidth: width, ...gradient } : solid ? { borderWidth: width, borderColor: solid } : null;
  const face: ViewStyle = { backgroundColor: colorOrUndefined(fill), borderRadius: corner, ...border };
  const shadow = shadowSpec(surfaceShadowColor, surfaceShadowOpacity, surfaceShadowRadius, offset[0], offset[1]);
  if (!shadow) {
    return (
      <View {...rest} ref={cover.ref} onLayout={cover.onLayout} style={[face, style as ViewStyle]}>
        {cover.within(children as ReactNode)}
      </View>
    );
  }
  const inset = border ? -width : 0;
  const around = { top: inset, left: inset, right: inset, bottom: inset };
  const frame: ViewStyle = { borderRadius: corner, ...(border ? { borderWidth: width, borderColor: CLEAR_BORDER } : null) };
  return (
    <View {...rest} ref={cover.ref} onLayout={cover.onLayout} style={[frame, style as ViewStyle]}>
      <RoundedShadow spec={shadow} cornerRadius={corner} around={around} />
      <View pointerEvents="none" style={[face, { position: "absolute", ...around }]} />
      {cover.within(children as ReactNode)}
    </View>
  );
});
