import { oklab, paletteColors, parseHex, PALETTES, type Vec4 } from "./colors";
import { MAX_POWER_UP_COLORS } from "./sources";
import type { Uniforms } from "./surface";

const f32 = Math.fround;

export type BackdropParams = { colors: [string, string] | string[]; angle?: number; grainOpacity?: number; grainScale?: number };

export function backdropUniforms({ colors, angle = 180, grainOpacity = 0.09, grainScale = 1 }: BackdropParams, viewSize: [number, number]): Uniforms {
  const rgba = colors.map(parseHex).filter((c): c is Vec4 => !!c);
  const first = rgba[0] ?? null;
  const labA = first ? oklab(first) : [0.27, 0.02, 0, 1];
  const labB = first ? oklab(rgba[rgba.length - 1] ?? first) : [0.23, 0.02, 0, 1];
  const r = f32(f32(angle) * f32(Math.PI) / 180);
  return {
    labA,
    labB,
    viewSize,
    direction: [f32(Math.sin(r)), f32(-Math.cos(r))],
    grainOpacity,
    grainScale,
  };
}

export const POWER_UP = { finishTime: 3.75, defaultSpeed: 1.25, defaultOrigin: 0.5, defaultCornerRadius: 20 };
export const HALO = { finishTime: 2, delay: 0.18, inset: 50, fadeOutStart: 1, fadeOutDuration: 0.2 };

export function powerUpPalette(palette: string | string[] | undefined): Vec4[] {
  const value = palette === undefined ? ["pink"] : typeof palette === "string" ? [palette] : palette;
  return (paletteColors(value) ?? PALETTES.pink!.map((h) => parseHex(h)!)).slice(0, MAX_POWER_UP_COLORS);
}

export type PowerUpParams = { srgb: Vec4[]; speed: number; origin: number };

export function powerUpUniforms({ srgb, speed, origin }: PowerUpParams, time: number): Uniforms {
  const lab = srgb.map(oklab);
  return {
    direction: 0,
    numberOfColors: lab.length,
    colors: lab.flat(),
    time,
    speed,
    delay: 0,
    fadeOutStart: 1,
    fadeOutDuration: 2,
    origin,
  };
}

export type HaloParams = { srgb: Vec4[]; speed: number; cornerRadius: number; dark: boolean };

export function haloUniforms({ srgb, speed, cornerRadius, dark }: HaloParams, resolution: [number, number], time: number): Uniforms {
  const first = srgb[0] ?? [1, 0.5176, 0.3098, 1];
  const second = srgb.length > 1 ? srgb[1]! : first;
  return {
    resolution,
    direction: 0,
    colors: [...first, ...second],
    isDark: dark,
    time,
    speed,
    delay: HALO.delay,
    fadeOutStart: HALO.fadeOutStart,
    fadeOutDuration: HALO.fadeOutDuration,
    inset: HALO.inset,
    cornerRadius: cornerRadius + 2,
  };
}
