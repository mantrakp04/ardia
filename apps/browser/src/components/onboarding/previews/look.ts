import { hex, nearestPreset, PROFILE_COLORS, themeFor, type Theme } from "../../ui/theme";
import { toolbarPalette, type ToolbarPalette } from "../../ui/toolbarColors";
import { backdropTint, opaqueTint, tintForHue } from "../../../lib/windowTint";
import type { ProfileColor } from "../../../state/browser/types";
import { SITE } from "./content";
import { mockPage } from "./tokens";

export type Look = {
  dark: boolean;
  t: Theme;
  tint: readonly [string, string];
  card: string;
  page: string;
  ink: string;
  inkDim: string;
  inkFaint: string;
  site: ToolbarPalette;
  plain: ToolbarPalette;
};

const looks = new Map<string, Look>();

function channels(color: string): [number, number, number, number] {
  const h = hex(color).replace("#", "");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length >= 8 ? n(6) / 255 : 1];
}

export function over(top: string, under: string): string {
  const [r, g, b, a] = channels(top);
  const [R, G, B] = channels(under);
  const mix = (x: number, y: number) => Math.round(x * a + y * (1 - a)).toString(16).padStart(2, "0");
  return `#${mix(r, R)}${mix(g, G)}${mix(b, B)}`.toUpperCase();
}

export function mixColors(a: string, b: string, t: number): string {
  const [r, g, bl] = channels(a);
  const [R, G, B] = channels(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${m(r, R)}${m(g, G)}${m(bl, B)}`.toUpperCase();
}

export function lookFor(dark: boolean, accent: string): Look {
  const key = `${dark}|${accent}`;
  const cached = looks.get(key);
  if (cached) return cached;
  const mode = dark ? "dark" : "light";
  const exact = (Object.keys(PROFILE_COLORS) as ProfileColor[]).find((c) => PROFILE_COLORS[c].swatch.toLowerCase() === accent.toLowerCase());
  const t = themeFor(`${exact ?? nearestPreset(accent)}:${mode}`);
  const tint = exact ? t.windowTint : opaqueTint(backdropTint(tintForHue(accent), false), dark);
  const look: Look = {
    dark,
    t,
    tint,
    card: over(t.card, mixColors(tint[0], tint[1], 0.5)),
    ...mockPage[mode],
    site: toolbarPalette(t, SITE[dark ? 1 : 0]),
    plain: toolbarPalette(t, null),
  };
  looks.set(key, look);
  return look;
}

export const pick = <T,>(look: Look, pair: readonly [T, T]) => pair[look.dark ? 1 : 0];
