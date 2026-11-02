import { GlassEffect, isLiquidGlass } from "@ardia/shell";
import { createContext, memo, useContext } from "react";
import { useTheme, type Theme } from "./theme";
import { parseColor, toHex } from "../../lib/color";

export const liquidGlass = isLiquidGlass();

const PROFILE_SHARE = 0.15;
const TINT_LIFT_PER_SHARE = 0.125;
const CONTROL_FILL_SHARE = 0.15;
const CONTROL_GLASS_STRENGTH = 0.5;
const PANEL_TINT_SHARE = 0.85;
const PANEL_GLASS_STRENGTH = 0.5;
const GLASS_STYLE = { control: "clear", panel: "regular" } as const;
const STATE_GAIN = { rest: 1, lit: 2, pressed: 3, active: 6 } as const;

export type GlassKind = keyof typeof GLASS_STYLE;
export type GlassState = keyof typeof STATE_GAIN;
export type GlassLook = { controls: boolean; panes: boolean; tint: number };

export const GlassLookContext = createContext<GlassLook>({ controls: liquidGlass, panes: liquidGlass, tint: 0 });

export const useGlassLook = () => useContext(GlassLookContext);

export function useGlass(surface: "controls" | "panes" = "controls"): boolean {
  return useGlassLook()[surface];
}

function profileTinted(theme: Theme, color: string, tinted: boolean, share = PROFILE_SHARE): string {
  const [r, g, b, a] = parseColor(color);
  if (!tinted) return toHex([r, g, b, a * 255]);
  const [pr, pg, pb] = parseColor(theme.backdrop.tintColor);
  const mix = (c: number, p: number) => c + (p - c) * share;
  return toHex([mix(r, pr), mix(g, pg), mix(b, pb), a * 255]);
}

export function controlGlassTint(theme: Theme, state: GlassState, tint: number): string {
  const [r, g, b, a] = parseColor(theme.pinnedResting);
  const alpha = Math.min(1, a * CONTROL_FILL_SHARE * STATE_GAIN[state] + tint * TINT_LIFT_PER_SHARE);
  return profileTinted(theme, toHex([r, g, b, alpha * 255]), tint > 0, tint);
}

export function panelGlassTint(theme: Theme, fill: string, tint: number): string {
  const [r, g, b, a] = parseColor(fill);
  const glassy = 1 - Math.min(1, a * PANEL_TINT_SHARE);
  return profileTinted(theme, toHex([r, g, b, (1 - glassy * PANEL_GLASS_STRENGTH) * 255]), tint > 0);
}

export const GlassFill = memo(function GlassFill({
  radius,
  border = 0,
  state = "rest",
  panelFill,
  dark,
  theme: shownTheme,
}: {
  radius: number;
  border?: number;
  state?: GlassState;
  panelFill?: string;
  dark?: boolean;
  theme?: Theme;
}) {
  const contextTheme = useTheme();
  const theme = shownTheme ?? contextTheme;
  const { tint } = useGlassLook();
  const shownDark = dark ?? theme.dark;
  const frame = { position: "absolute", top: -border, left: -border, right: -border, bottom: -border } as const;
  return (
    <GlassEffect
      pointerEvents="none"
      glassStyle={GLASS_STYLE[panelFill ? "panel" : "control"]}
      cornerRadius={radius}
      tint={panelFill ? panelGlassTint(theme, panelFill, tint) : controlGlassTint(theme, state, tint)}
      dark={shownDark}
      style={[frame, panelFill ? null : { opacity: CONTROL_GLASS_STRENGTH }]}
    />
  );
});
