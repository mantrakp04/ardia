import { usePageCover } from "../engine/usePageCover";
import { forwardRef, useCallback, useState } from "react";
import type { GlassEffectProps, GlassGroupProps, NativePopoverBubbleProps, VisualEffectProps } from "@ardia/shell";
import { StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from "react-native";
import { parseColor, rgbaString } from "./color";
import { bubblePath, NativeMaterialBlur, nativeBlur } from "./nativeMaterials";
import { useAppDark as useDark } from "./appearance";
import { RoundedShadow } from "./RoundedShadow";
import { shadowSpec } from "./shadowLayers";
import { colorOrUndefined, finite, useFirstWindow } from "./shared";

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

type Blur = { radius: number; saturation: number; alpha: { light: number; dark: number } };

const MATERIAL_BLUR: Record<string, Blur> = {
  popover: { radius: 24, saturation: 1.5, alpha: { light: 0.72, dark: 0.72 } },
  menu: { radius: 24, saturation: 1.5, alpha: { light: 0.72, dark: 0.72 } },
  toolTip: { radius: 16, saturation: 1.3, alpha: { light: 0.86, dark: 0.86 } },
  sheet: { radius: 30, saturation: 1.4, alpha: { light: 0.84, dark: 0.84 } },
  hudWindow: { radius: 30, saturation: 1.6, alpha: { light: 0.55, dark: 0.65 } },
  sidebar: { radius: 30, saturation: 1.6, alpha: { light: 0.6, dark: 0.6 } },
  underWindowBackground: { radius: 30, saturation: 1.6, alpha: { light: 0.4, dark: 0.4 } },
  contentBackground: { radius: 30, saturation: 1.2, alpha: { light: 0.9, dark: 0.9 } },
  fullScreenUI: { radius: 30, saturation: 1.5, alpha: { light: 0.75, dark: 0.75 } },
};
const DEFAULT_BLUR: Blur = { radius: 24, saturation: 1.5, alpha: { light: 0.72, dark: 0.72 } };
const GLASS_BLUR = { regular: { radius: 12, saturation: 1.8 }, clear: { radius: 6, saturation: 1.4 } };

function materialBlur(material: unknown, dark: boolean): { tint: string; radius: number; saturation: number } | null {
  const name = typeof material === "string" ? material : "popover";
  if (name === "windowBackground") return null;
  const blur = MATERIAL_BLUR[name] ?? DEFAULT_BLUR;
  const fill = parseColor(materialFill(name, dark));
  if (!fill) return null;
  return { tint: rgbaString([fill[0], fill[1], fill[2], blur.alpha[dark ? "dark" : "light"]]), radius: blur.radius, saturation: blur.saturation };
}

const GLASS_FILL = { regular: { light: "rgba(250,250,250,0.55)", dark: "rgba(44,44,46,0.5)" }, clear: { light: "rgba(255,255,255,0.18)", dark: "rgba(255,255,255,0.08)" } };
const GLASS_RIM = {
  light: { top: "rgba(255,255,255,0.7)", side: "rgba(255,255,255,0.38)", bottom: "rgba(255,255,255,0.22)" },
  dark: { top: "rgba(255,255,255,0.3)", side: "rgba(255,255,255,0.14)", bottom: "rgba(255,255,255,0.08)" },
};

export const VisualEffect = forwardRef<View, VisualEffectProps>(function VisualEffect({ material, blendingMode: _blendingMode, cornerRadius, style, children, ...rest }, ref) {
  useFirstWindow();
  const dark = useDark(undefined);
  const radius = Math.max(0, finite(cornerRadius, 0));
  const fill = materialFill(material, dark);
  const blur = nativeBlur() ? materialBlur(material, dark) : null;
  const look: ViewStyle = { backgroundColor: blur ? undefined : fill, borderRadius: radius, overflow: radius > 0 ? "hidden" : undefined };
  return (
    <View {...rest} ref={ref} pointerEvents="none" style={[look, style]}>
      {blur ? (
        <NativeMaterialBlur
          pointerEvents="none"
          fallbackColor={fill}
          tintColor={blur.tint}
          blurRadius={blur.radius}
          saturation={blur.saturation}
          cornerRadius={radius}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {children}
    </View>
  );
});

export const GlassEffect = forwardRef<View, GlassEffectProps>(function GlassEffect({ cornerRadius, tint, glassStyle, dark, style, children, ...rest }, ref) {
  const tone = useDark(dark) ? "dark" : "light";
  const radius = Math.max(0, finite(cornerRadius, 0));
  const rim = GLASS_RIM[tone];
  const kind = glassStyle === "clear" ? "clear" : "regular";
  const fill = GLASS_FILL[kind][tone];
  const blurs = nativeBlur();
  const look: ViewStyle = {
    backgroundColor: blurs ? undefined : fill,
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
    <View {...rest} ref={ref} pointerEvents="none" style={[look, style]}>
      {blurs ? (
        <NativeMaterialBlur
          pointerEvents="none"
          fallbackColor={fill}
          tintColor={fill}
          blurRadius={GLASS_BLUR[kind].radius}
          saturation={GLASS_BLUR[kind].saturation}
          cornerRadius={Math.max(0, radius - 1)}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {tintColor ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tintColor }]} /> : null}
      {children}
    </View>
  );
});

export const GlassGroup = forwardRef<View, GlassGroupProps>(function GlassGroup({ strength: _strength, children, ...rest }, ref) {
  return (
    <View {...rest} ref={ref}>
      {children}
    </View>
  );
});

const ROOT_TWO = Math.SQRT2;
const CLEAR = "rgba(0,0,0,0)";

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

export const PopoverBubble = forwardRef<View, NativePopoverBubbleProps>(function PopoverBubble(
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
      onLayout?.(event);
    },
    [onLayout],
  );
  const edge = arrowEdge === "top" || arrowEdge === "bottom" ? arrowEdge : "none";
  const lift = edge === "none" ? 0 : Math.min(Math.max(0, finite(arrowHeight, 9)), size.height);
  const bodyHeight = Math.max(0, size.height - lift);
  const radius = Math.max(0, Math.min(finite(cornerRadius, 12), size.width / 2, bodyHeight / 2));
  const half = Math.max(0, finite(arrowWidth, 20)) / 2;
  const fill = materialFill(material, isDark);
  const blur = nativeBlur() ? materialBlur(material, isDark) : null;
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
    backgroundColor: blur ? undefined : fill,
    ...(edgeTint && stroke > 0 ? { borderWidth: stroke, borderColor: edgeTint } : null),
  };
  const shadow = blur ? null : shadowSpec("#000000", bubbleShadowOpacity, bubbleShadowRadius, 0, bubbleShadowOffsetY);
  const bodyEdges = { top: edge === "top" ? lift : 0, left: 0, right: 0, bottom: edge === "bottom" ? lift : 0 };
  const showsArrow = edge !== "none" && half > 0 && lift > 0 && size.width >= 2 * (radius + half);
  const center = Math.min(Math.max(finite(arrowX, 0), radius + half), size.width - radius - half);
  const cover = usePageCover(ref, measure, radius);
  return (
    <View {...rest} ref={cover.ref} onLayout={cover.onLayout} pointerEvents="none" style={style}>
      {size.width > 0 ? (
        <>
          {blur ? (
            <NativeMaterialBlur
              pointerEvents="none"
              fallbackColor={fill}
              tintColor={blur.tint}
              blurRadius={blur.radius}
              saturation={blur.saturation}
              shape={bubblePath(size.width, size.height, finite(cornerRadius, 12), edge, finite(arrowX, 0), Math.max(0, finite(arrowWidth, 20)), Math.max(0, finite(arrowHeight, 9)))}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          {shadow ? <RoundedShadow spec={shadow} cornerRadius={radius} around={bodyEdges} /> : null}
          <View style={body} />
          {tintColor ? <View style={[body, { backgroundColor: tintColor, borderWidth: 0 }]} /> : null}
          {showsArrow ? <Arrow edge={edge} center={center} width={half * 2} height={lift} fill={blur ? CLEAR : fill} tint={tintColor} edgeColor={edgeTint} edgeWidth={stroke} /> : null}
        </>
      ) : null}
      {children}
    </View>
  );
});
