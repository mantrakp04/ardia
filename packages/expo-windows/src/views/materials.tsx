import { forwardRef, useCallback, useState, type ReactNode } from "react";
import { StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from "react-native";
import { colorOrUndefined, dropShadow, finite, useDark, useFirstWindow, type AnyProps } from "./shared";

type Tone = { light: string; dark: string };

const MATERIAL_FILL: Record<string, Tone> = {
  popover: { light: "rgba(246,246,246,0.94)", dark: "rgba(40,40,42,0.94)" },
  menu: { light: "rgba(246,246,246,0.94)", dark: "rgba(40,40,42,0.94)" },
  toolTip: { light: "rgba(250,250,250,0.97)", dark: "rgba(50,50,52,0.97)" },
  sheet: { light: "rgba(236,236,236,0.97)", dark: "rgba(44,44,46,0.97)" },
  hudWindow: { light: "rgba(30,30,30,0.75)", dark: "rgba(30,30,30,0.82)" },
  sidebar: { light: "rgba(236,236,236,0.6)", dark: "rgba(30,30,32,0.6)" },
  underWindowBackground: { light: "rgba(240,240,240,0.4)", dark: "rgba(28,28,30,0.4)" },
  contentBackground: { light: "rgba(255,255,255,0.96)", dark: "rgba(30,30,30,0.96)" },
  fullScreenUI: { light: "rgba(242,242,242,0.9)", dark: "rgba(36,36,38,0.9)" },
  windowBackground: { light: "rgb(236,236,236)", dark: "rgb(50,50,50)" },
};
const DEFAULT_FILL: Tone = { light: "rgba(246,246,246,0.85)", dark: "rgba(40,40,42,0.85)" };

const materialFill = (material: unknown, dark: boolean) => (MATERIAL_FILL[typeof material === "string" ? material : "popover"] ?? DEFAULT_FILL)[dark ? "dark" : "light"];

const GLASS_FILL = { regular: { light: "rgba(250,250,250,0.55)", dark: "rgba(44,44,46,0.5)" }, clear: { light: "rgba(255,255,255,0.18)", dark: "rgba(255,255,255,0.08)" } };
const GLASS_RIM = {
  light: { top: "rgba(255,255,255,0.7)", side: "rgba(255,255,255,0.38)", bottom: "rgba(255,255,255,0.22)" },
  dark: { top: "rgba(255,255,255,0.3)", side: "rgba(255,255,255,0.14)", bottom: "rgba(255,255,255,0.08)" },
};

export const VisualEffect = forwardRef<View, AnyProps>(function VisualEffect({ material, blendingMode: _blendingMode, cornerRadius, style, children, ...rest }, ref) {
  useFirstWindow();
  const dark = useDark(undefined);
  const radius = Math.max(0, finite(cornerRadius, 0));
  const look: ViewStyle = { backgroundColor: materialFill(material, dark), borderRadius: radius, overflow: radius > 0 ? "hidden" : undefined };
  return (
    <View {...rest} ref={ref} pointerEvents="none" style={[look, style as ViewStyle]}>
      {children as ReactNode}
    </View>
  );
});

export const GlassEffect = forwardRef<View, AnyProps>(function GlassEffect({ cornerRadius, tint, glassStyle, dark, style, children, ...rest }, ref) {
  const tone = useDark(dark) ? "dark" : "light";
  const radius = Math.max(0, finite(cornerRadius, 0));
  const rim = GLASS_RIM[tone];
  const look: ViewStyle = {
    backgroundColor: GLASS_FILL[glassStyle === "clear" ? "clear" : "regular"][tone],
    borderRadius: radius,
    borderWidth: 1,
    borderTopColor: rim.top,
    borderLeftColor: rim.side,
    borderRightColor: rim.side,
    borderBottomColor: rim.bottom,
    overflow: radius > 0 ? "hidden" : undefined,
  };
  const tintColor = colorOrUndefined(tint);
  return (
    <View {...rest} ref={ref} pointerEvents="none" style={[look, style as ViewStyle]}>
      {tintColor ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tintColor }]} /> : null}
      {children as ReactNode}
    </View>
  );
});

export const GlassGroup = forwardRef<View, AnyProps>(function GlassGroup({ strength: _strength, children, ...rest }, ref) {
  return (
    <View {...rest} ref={ref}>
      {children as ReactNode}
    </View>
  );
});

const ROOT_TWO = Math.SQRT2;

type ArrowProps = { edge: "top" | "bottom"; center: number; width: number; height: number; fill: string; tint?: string; edgeColor?: string; edgeWidth: number };

function Arrow({ edge, center, width, height, fill, tint, edgeColor, edgeWidth }: ArrowProps) {
  const half = width / 2;
  const side = width / ROOT_TWO;
  const diamond: ViewStyle = {
    position: "absolute",
    left: half - side / 2,
    top: (edge === "top" ? height : 0) - side / 2,
    width: side,
    height: side,
    borderRadius: 2,
    transform: [{ scaleY: height / half }, { rotate: "45deg" }],
  };
  const box: ViewStyle = { position: "absolute", left: center - half, width, height, overflow: "hidden", ...(edge === "top" ? { top: 0 } : { bottom: 0 }) };
  return (
    <View pointerEvents="none" style={box}>
      <View style={[diamond, { backgroundColor: fill }]} />
      {tint ? <View style={[diamond, { backgroundColor: tint }]} /> : null}
      {edgeColor && edgeWidth > 0 ? <View style={[diamond, { borderWidth: edgeWidth, borderColor: edgeColor }]} /> : null}
    </View>
  );
}

export const PopoverBubble = forwardRef<View, AnyProps>(function PopoverBubble(
  { material, dark, cornerRadius, arrowEdge, arrowX, arrowWidth, arrowHeight, tint, edgeColor, edgeWidth, bubbleShadowOpacity, bubbleShadowRadius, bubbleShadowOffsetY, glass: _glass, style, onLayout, children, ...rest },
  ref,
) {
  useFirstWindow();
  const isDark = useDark(dark);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const measure = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
      if (typeof onLayout === "function") onLayout(event);
    },
    [onLayout],
  );
  const edge = arrowEdge === "top" || arrowEdge === "bottom" ? arrowEdge : "none";
  const lift = edge === "none" ? 0 : Math.min(Math.max(0, finite(arrowHeight, 9)), size.height);
  const bodyHeight = Math.max(0, size.height - lift);
  const radius = Math.max(0, Math.min(finite(cornerRadius, 12), size.width / 2, bodyHeight / 2));
  const half = Math.max(0, finite(arrowWidth, 20)) / 2;
  const fill = materialFill(material, isDark);
  const tintColor = colorOrUndefined(tint);
  const edgeTint = colorOrUndefined(edgeColor);
  const stroke = Math.max(0, finite(edgeWidth, 0));
  const body: ViewStyle = {
    position: "absolute",
    left: 0,
    right: 0,
    top: edge === "top" ? lift : 0,
    bottom: edge === "bottom" ? lift : 0,
    borderRadius: radius,
    backgroundColor: fill,
    ...(edgeTint && stroke > 0 ? { borderWidth: stroke, borderColor: edgeTint } : null),
    ...dropShadow("#000000", bubbleShadowOpacity, bubbleShadowRadius, 0, bubbleShadowOffsetY),
  };
  const showsArrow = edge !== "none" && half > 0 && lift > 0 && size.width >= 2 * (radius + half);
  const center = Math.min(Math.max(finite(arrowX, 0), radius + half), size.width - radius - half);
  return (
    <View {...rest} ref={ref} onLayout={measure} pointerEvents="none" style={style as ViewStyle}>
      {size.width > 0 ? (
        <>
          <View style={body} />
          {tintColor ? <View style={[body, { backgroundColor: tintColor, borderWidth: 0, shadowOpacity: 0 }]} /> : null}
          {showsArrow ? <Arrow edge={edge} center={center} width={half * 2} height={lift} fill={fill} tint={tintColor} edgeColor={edgeTint} edgeWidth={stroke} /> : null}
        </>
      ) : null}
      {children as ReactNode}
    </View>
  );
});
