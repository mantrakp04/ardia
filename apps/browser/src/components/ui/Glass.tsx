import { GlassEffect, isLiquidGlass } from "@ardia/shell";
import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { useTheme, type Theme } from "./theme";
import { glassRim } from "./tokens";
import { parseColor, toHex } from "../../lib/color";

export const liquidGlass = isLiquidGlass();

const PROFILE_SHARE = 0.15;
const TINT_SHARE = { control: 0.15, panel: 0.85 } as const;
const GLASS_STYLE = { control: "clear", panel: "regular" } as const;
const TINT_GAIN = { rest: 1, lit: 2, active: 6 } as const;

export type GlassKind = keyof typeof TINT_SHARE;
export type GlassState = keyof typeof TINT_GAIN;

export function glassTint(theme: Theme, fill: string, kind: GlassKind, state: GlassState): string {
  const [r, g, b, a] = parseColor(fill);
  const [pr, pg, pb] = parseColor(theme.backdrop.tintColor);
  const alpha = Math.min(1, a * TINT_SHARE[kind] * TINT_GAIN[state]);
  const mix = (c: number, p: number) => c + (p - c) * PROFILE_SHARE;
  return toHex([mix(r, pr), mix(g, pg), mix(b, pb), alpha * 255]);
}

export const GlassFill = memo(function GlassFill({
  fill,
  radius,
  border = 0,
  state = "rest",
  kind = "control",
  dark,
}: {
  fill: string;
  radius: number;
  border?: number;
  state?: GlassState;
  kind?: GlassKind;
  dark?: boolean;
}) {
  const theme = useTheme();
  const frame = { position: "absolute", top: -border, left: -border, right: -border, bottom: -border } as const;
  return (
    <>
      <GlassEffect
        pointerEvents="none"
        glassStyle={GLASS_STYLE[kind]}
        cornerRadius={radius}
        tint={glassTint(theme, fill, kind, state)}
        dark={dark ?? theme.dark}
        style={frame}
      />
      <View
        pointerEvents="none"
        style={[frame, { borderRadius: radius, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, borderColor: state === "rest" ? glassRim.rest : glassRim.lit }]}
      />
    </>
  );
});
