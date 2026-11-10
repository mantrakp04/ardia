import { forwardRef, memo, useMemo, type ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { Bands } from "./Bands";
import { adjustingLightness, flatStops, hslToRgb, parseColor, rgbaString, type Rgba } from "./color";
import { useAppDark } from "./appearance";
import { NativeWindowMaterial, nativeWindowMaterial } from "./nativeMaterials";
import { finite, useFirstWindow, type AnyProps } from "./shared";

const VIBRANCY = {
  dark: { material: [68.3 / 255, 68.0 / 255, 68.4 / 255], white: 0, alpha: 0.4, gradientOpacity: 0.5 },
  light: { material: [211.2 / 255, 206.7 / 255, 206.0 / 255], white: 1, alpha: 0.8, gradientOpacity: 0.75 },
};
const DEFAULT_TINT: Rgba = [0.5, 0.5, 0.5, 1];
const DEFAULT_THEME_ANGLE = 135;
const OVERLAY_TURN = 45;
const PAD_CELLS = 16;
const THEME_REACH = 0.75;
const WINDOW_MATERIAL = "micaAlt";

function underColor(dark: boolean, baseAlpha?: number): Rgba {
  const look = dark ? VIBRANCY.dark : VIBRANCY.light;
  const alpha = baseAlpha ?? look.alpha;
  const white = baseAlpha === undefined ? look.white : dark ? 0 : 1;
  const [r, g, b] = look.material.map((value) => white * alpha + value * (1 - alpha)) as [number, number, number];
  return [r, g, b, 1];
}

function tintOverMaterial(dark: boolean, baseAlpha?: number): Rgba {
  const look = dark ? VIBRANCY.dark : VIBRANCY.light;
  const white = dark ? 0 : 1;
  return [white, white, white, baseAlpha ?? look.alpha];
}

export type WindowBackdropColors = { fallback: Rgba; tint: Rgba; gradientOpacity: number };

export function windowBackdropColors(dark: boolean, baseAlpha?: number): WindowBackdropColors {
  return { fallback: underColor(dark, baseAlpha), tint: tintOverMaterial(dark, baseAlpha), gradientOpacity: (dark ? VIBRANCY.dark : VIBRANCY.light).gradientOpacity };
}

function MaterialBase({ dark, baseAlpha }: { dark: boolean; baseAlpha?: number }) {
  const colors = windowBackdropColors(dark, baseAlpha);
  const fallback = rgbaString(colors.fallback);
  if (!nativeWindowMaterial()) return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: fallback }]} />;
  return (
    <NativeWindowMaterial
      pointerEvents="none"
      material={WINDOW_MATERIAL}
      dark={dark}
      fallbackColor={fallback}
      tintColor={rgbaString(colors.tint)}
      style={StyleSheet.absoluteFill}
    />
  );
}

function ThemeLayers({ stops, angle, opacity }: { stops: Rgba[]; angle: number; opacity?: number }) {
  if (stops.length === 0) return null;
  const base = stops.slice(0, 2);
  const overlay = stops[2];
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
      <Bands stops={base} angle={angle} span="base" reach={THEME_REACH} />
      {overlay ? <Bands stops={[[overlay[0], overlay[1], overlay[2], 0], overlay]} angle={angle + OVERLAY_TURN} span="corner" count={8} /> : null}
    </View>
  );
}

const colorList = (colors: unknown): Rgba[] => (Array.isArray(colors) ? colors.map(parseColor).filter((stop): stop is Rgba => !!stop) : []);

export const WindowBackdrop = forwardRef<View, AnyProps>(function WindowBackdrop(
  {
    colors,
    vibrancy,
    tintColor,
    tintAlpha,
    tintLightness,
    angle,
    grainOpacity: _grainOpacity,
    grainScale: _grainScale,
    themeColors,
    themeOpacity,
    themeBaseAlpha,
    themeGrain: _themeGrain,
    themeTexture: _themeTexture,
    themeAppearance,
    themeAngle,
    style,
    children,
    ...rest
  },
  ref,
) {
  useFirstWindow();
  const appDark = useAppDark(undefined);
  const theme = useMemo(() => flatStops(themeColors), [themeColors]);
  const dark = theme.length > 0 && themeAppearance === "dark" ? true : theme.length > 0 && themeAppearance === "light" ? false : appDark;
  let layers;
  if (vibrancy === true) {
    const { gradientOpacity } = windowBackdropColors(dark);
    if (theme.length > 0) {
      layers = (
        <>
          <MaterialBase dark={dark} baseAlpha={Math.min(1, Math.max(0, finite(themeBaseAlpha, 0)))} />
          <ThemeLayers stops={theme} angle={finite(themeAngle, DEFAULT_THEME_ANGLE)} opacity={Math.min(1, Math.max(0, finite(themeOpacity, 1)))} />
        </>
      );
    } else {
      const tint = parseColor(tintColor) ?? DEFAULT_TINT;
      const alpha = Math.min(1, Math.max(0, finite(tintAlpha, 0.36)));
      const lighter = adjustingLightness(tint, finite(tintLightness, 0.25));
      layers = (
        <>
          <MaterialBase dark={dark} />
          <Bands stops={[[tint[0], tint[1], tint[2], alpha], [lighter[0], lighter[1], lighter[2], alpha]]} opacity={gradientOpacity} count={12} />
        </>
      );
    }
  } else {
    const stops = colorList(colors);
    const ends = stops.length > 1 ? [stops[0]!, stops[stops.length - 1]!] : stops;
    layers = <Bands stops={ends} angle={finite(angle, 180)} />;
  }
  return (
    <View {...rest} ref={ref} pointerEvents="none" style={style as ViewStyle}>
      {layers}
      {children as ReactNode}
    </View>
  );
});

const ColorPad = memo(function ColorPad({ lightness }: { lightness: number }) {
  const rows = [];
  for (let y = 0; y < PAD_CELLS; y++) {
    const cells = [];
    for (let x = 0; x < PAD_CELLS; x++) {
      const dx = (x + 0.5) / PAD_CELLS - 0.5;
      const dy = (y + 0.5) / PAD_CELLS - 0.5;
      let hue = Math.atan2(dy, dx) / (2 * Math.PI);
      if (hue < 0) hue += 1;
      const saturation = Math.min(1, Math.hypot(dx, dy) / 0.5);
      const [r, g, b] = hslToRgb(hue, saturation, lightness);
      cells.push(<View key={x} style={{ flex: 1, backgroundColor: rgbaString([r, g, b, 1]) }} />);
    }
    rows.push(
      <View key={y} style={{ flex: 1, flexDirection: "row" }}>
        {cells}
      </View>,
    );
  }
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {rows}
    </View>
  );
});

export const ThemeSwatch = forwardRef<View, AnyProps>(function ThemeSwatch({ colors, grain: _grain, texture: _texture, padLightness, angle, style, children, ...rest }, ref) {
  const stops = useMemo(() => flatStops(colors), [colors]);
  const pad = finite(padLightness, -1);
  return (
    <View {...rest} ref={ref} pointerEvents="none" style={style as ViewStyle}>
      <ThemeLayers stops={stops} angle={finite(angle, DEFAULT_THEME_ANGLE)} />
      {pad >= 0 ? <ColorPad lightness={Math.min(1, pad)} /> : null}
      {children as ReactNode}
    </View>
  );
});
