import { requireNativeViewManager, requireOptionalNativeModule } from "expo-modules-core";
import type { ComponentType } from "react";
import { View, type ViewProps } from "react-native";

export const DIA_SPECTRUM = ["#0358F7", "#5092C7", "#E1E1FE", "#FFD400", "#FA3D1D", "#FD02F5"];

export type Rect = { x: number; y: number; width: number; height: number };

export type AreaLightPalette = "blue" | "red" | "pink" | "orange" | "yellow" | "green" | "purple";

export type WindowBackdropProps = ViewProps & {
  colors: [string, string];
  vibrancy?: boolean;
  tintColor?: string;
  tintAlpha?: number;
  tintLightness?: number;
  angle?: number;
  grainOpacity?: number;
  grainScale?: number;
  themeColors?: number[];
  themeOpacity?: number;
  themeBaseAlpha?: number;
  themeGrain?: number;
  themeTexture?: "grain" | "sand" | "denim" | "tweed";
  themeAppearance?: "auto" | "light" | "dark";
  themeAngle?: number;
};

const NativeBackdrop = requireNativeViewManager<WindowBackdropProps>("ArdiaWindowBackdrop");

const BackdropModule = requireOptionalNativeModule<{ holdKeyLook?: (on: boolean) => Promise<void> }>("ArdiaWindowBackdrop");

export function holdThemedWindowsKeyLook(on: boolean) {
  void BackdropModule?.holdKeyLook?.(on);
}

export function WindowBackdrop({ angle = 180, grainOpacity = 0.09, grainScale = 1, ...props }: WindowBackdropProps) {
  return <NativeBackdrop pointerEvents="none" angle={angle} grainOpacity={grainOpacity} grainScale={grainScale} {...props} />;
}

const rect = (r: Rect) => [r.x, r.y, r.width, r.height];

export type PowerUpProps = ViewProps & {
  palette?: AreaLightPalette | string[];
  speed?: number;
  origin?: number;
  cornerRadius?: number;
  halo?: Rect | null;
};

type NativePowerUpProps = Omit<PowerUpProps, "palette" | "halo"> & { palette?: string[]; haloFrame: number[] };

const NativePowerUp = requireNativeViewManager<NativePowerUpProps>("ArdiaPowerUp");

export function PowerUp({ palette = "pink", halo = null, ...props }: PowerUpProps) {
  return (
    <NativePowerUp
      pointerEvents="none"
      {...props}
      palette={typeof palette === "string" ? [palette] : palette}
      haloFrame={halo ? rect(halo) : [0, 0, 0, 0]}
    />
  );
}


export type ThemeSwatchProps = ViewProps & {
  colors: number[];
  grain?: number;
  texture?: "grain" | "sand" | "denim" | "tweed";
  padLightness?: number;
  angle?: number;
};

const hasThemeSwatch = !!(globalThis as { expo?: { getViewConfig?: (name: string) => unknown } }).expo?.getViewConfig?.("ArdiaThemeSwatch");
const NativeThemeSwatch = hasThemeSwatch ? requireNativeViewManager<ThemeSwatchProps>("ArdiaThemeSwatch") : null;

export function ThemeSwatch({ grain = 0, padLightness = -1, angle = 135, style, ...props }: ThemeSwatchProps) {
  if (!NativeThemeSwatch) return <View pointerEvents="none" style={[style, { backgroundColor: "#80808040" }]} />;
  return <NativeThemeSwatch pointerEvents="none" grain={grain} padLightness={padLightness} angle={angle} style={style} {...props} />;
}

export type MeadowTone = { tone: "light" | "dark"; halo: number };

const MEADOW_INK = {
  light: { ink: "#16130F", halo: [243, 236, 223] },
  dark: { ink: "#EFE8DC", halo: [18, 16, 26] },
} as const;

export function meadowTextStyle({ tone, halo }: MeadowTone) {
  const { ink, halo: rgb } = MEADOW_INK[tone];
  return {
    color: ink,
    textShadowColor: `rgba(${rgb.join(",")},${Math.min(1, Math.max(0, halo))})`,
    textShadowRadius: 2,
    textShadowOffset: { width: 0, height: 0 },
  };
}

export type MeadowProps = ViewProps & { night: boolean; onTone?: (tone: MeadowTone) => void };

type NativeMeadowProps = ViewProps & { night: boolean; onTone?: (event: { nativeEvent: MeadowTone }) => void };

let NativeMeadow: ComponentType<NativeMeadowProps> | null = null;

export function Meadow({ onTone, ...props }: MeadowProps) {
  NativeMeadow ??= requireNativeViewManager<NativeMeadowProps>("ArdiaMeadow");
  return <NativeMeadow pointerEvents="none" {...props} onTone={onTone ? (event) => onTone(event.nativeEvent) : undefined} />;
}
