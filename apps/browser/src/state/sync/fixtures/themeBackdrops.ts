import {
  lookAngle,
  opaqueThemeTint,
  shownLook,
  themeAccent,
  themeArea,
  themeGrainAlpha,
  themeLayerAlpha,
  themeLuminance,
  themeUnderColor,
  themeUnderlayAlpha,
  type ProfileTheme,
  type ThemeLook,
} from "../../../lib/profileLook";
import type { ThemeMode, ThemeTexture } from "@ardia/core";

type SyncedStop = { r: number; g: number; b: number; a: number; x: number; y: number };
type SyncedLook = { stops: SyncedStop[]; intensity: number; grain: number; texture: ThemeTexture; translucency: number; angle: number };
type SyncedTheme = { mode: ThemeMode; light: SyncedLook; dark: SyncedLook | null };

type Sample = [x: number, y: number, width: number, height: number];

export type BackdropCase = { theme: SyncedTheme; appDark: boolean; followsAppearance: boolean; samples: Sample[] };

const macLook = (look: SyncedLook): ThemeLook => ({
  stops: look.stops.map(({ r, g, b, a, x, y }) => ({ color: { r, g, b, a }, x, y })),
  intensity: look.intensity,
  grain: look.grain,
  texture: look.texture,
  translucency: look.translucency,
  angle: look.angle,
});

export const macTheme = (theme: SyncedTheme): ProfileTheme => ({ ...macLook(theme.light), mode: theme.mode, ...(theme.dark ? { dark: macLook(theme.dark) } : {}) });

export function expectedBackdrop({ theme, appDark, followsAppearance, samples }: BackdropCase) {
  const { look, requestedDark, dark } = shownLook(macTheme(theme), appDark, followsAppearance ? "app" : "own");
  return {
    requestedDark,
    dark,
    stops: look.stops.map((s) => [s.color.r, s.color.g, s.color.b, s.color.a]),
    angle: lookAngle(look),
    layerAlpha: themeLayerAlpha(look),
    underlayAlpha: themeUnderlayAlpha(look, dark),
    grainAlpha: themeGrainAlpha(look),
    texture: look.texture,
    under: themeUnderColor(look, dark),
    tint: opaqueThemeTint(look, dark),
    accent: themeAccent(look),
    luminance: themeLuminance(look, dark),
    samples: samples.map(([x, y, width, height]) => themeArea(look, x, y, width, height)),
  };
}

const stop = (r: number, g: number, b: number, a = 1, x = 0.5, y = 0.5): SyncedStop => ({ r, g, b, a, x, y });

const look = (stops: SyncedStop[], fields: Partial<Omit<SyncedLook, "stops">> = {}): SyncedLook => ({
  stops,
  intensity: 0.6,
  grain: 0,
  texture: "grain",
  translucency: 1,
  angle: 135,
  ...fields,
});

const hexByte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0").toUpperCase();
const hexOf = (s: SyncedStop) => `#${hexByte(s.r)}${hexByte(s.g)}${hexByte(s.b)}${s.a < 1 ? hexByte(s.a) : ""}`;

const theme = (mode: ThemeMode, light: SyncedLook, dark: SyncedLook | null = null) => ({
  colors: light.stops.map(hexOf),
  darkColors: dark ? dark.stops.map(hexOf) : null,
  mode,
  light,
  dark,
});

const MEADOW = theme("auto", look([stop(0.3, 0.75, 0.45, 1, 0.2, 0.3), stop(0.85, 0.3, 0.65, 1, 0.8, 0.7)], { intensity: 0.8 }));
const ARC = theme(
  "dark",
  look([stop(0.2, 0.4, 0.9, 1, 0.1, 0.9), stop(1.2, -0.1, 0.5, 0.8, 1, 0.5), stop(0.95, 0.85, 0.2, 0.8, 0, 0)], { intensity: 1, grain: 0.35, texture: "tweed", translucency: 0.25, angle: 300 }),
  look([stop(0.1, 0.1, 0.2, 1, 0.5, 0.5), stop(0.25, 0.1, 0.35)], { intensity: 0.3, grain: 0.6, texture: "denim", translucency: 0, angle: 5 }),
);
const NIGHT = theme("auto", look([stop(0.05, 0.05, 0.12), stop(0.12, 0.08, 0.2)], { translucency: 0.5, grain: 1, texture: "sand", angle: 90 }));
const PALE = theme("light", look([stop(0.97, 0.93, 0.85), stop(0.9, 0.95, 0.86), stop(0.8, 0.9, 1, 0.5)], { intensity: 0.1, translucency: 0.8, angle: 0 }));
const SINGLE = theme("auto", look([stop(0.6, 0.2, 0.3)], { intensity: 0.45, translucency: 0.6, angle: 210 }));
const OPAQUE = theme(
  "auto",
  look([stop(0.31, 0.49, 1), stop(0.61, 0.42, 1)], { intensity: 1, translucency: 0 }),
  look([stop(0.12, 0.16, 0.35), stop(0.23, 0.14, 0.4)], { intensity: 1, translucency: 0 }),
);

const SAMPLES: Sample[] = [
  [0, 0, 1, 1], [1, 1, 1, 1], [0.5, 0.5, 1, 1], [0.25, 0.8, 1, 1],
  [0, 0, 390, 844], [390, 844, 390, 844], [200, 120, 390, 844], [60, 700, 390, 844],
  [0, 0, 1194, 834], [1194, 0, 1194, 834], [800, 600, 1194, 834],
];

const CASES: [name: string, theme: ReturnType<typeof theme>, appDark: boolean, followsAppearance: boolean][] = [
  ["two stops in light", MEADOW, false, true],
  ["two stops in dark, darkened as the Mac does", MEADOW, true, true],
  ["three stops with alpha and a dark look, light app", ARC, false, true],
  ["three stops with alpha and a dark look, dark app", ARC, true, true],
  ["a forced dark theme on its own appearance", ARC, false, false],
  ["a night theme reads dark in a light app", NIGHT, false, true],
  ["a night theme in dark", NIGHT, true, true],
  ["a pale light-only theme in dark", PALE, true, true],
  ["a pale theme forced light on its own", PALE, true, false],
  ["one stop", SINGLE, false, true],
  ["one stop in dark", SINGLE, true, true],
  ["an opaque gradient with a dark look", OPAQUE, true, true],
];

export function backdropFixture() {
  return {
    cases: CASES.map(([name, synced, appDark, followsAppearance]) => {
      const input = { name, theme: synced, appDark, followsAppearance, samples: SAMPLES };
      return { ...input, expect: expectedBackdrop(input) };
    }),
  };
}
