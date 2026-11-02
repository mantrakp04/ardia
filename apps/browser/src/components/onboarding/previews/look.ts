import { nearestPreset, PROFILE_COLORS, themeFor, type Theme } from "../../ui/theme";
import { opaqueCard } from "../../ui/opaqueCard";
import { toolbarPalette, type ToolbarPalette } from "../../ui/toolbarColors";
import { backdropTint, opaqueTint, tintForHue } from "../../../lib/windowTint";
import type { ProfileColor } from "../../../state/browser/types";
import { SITE } from "./content";
import type { BasePalette } from "../../../lib/themeFile";
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
let looksRevision = 0;

export function lookFor(dark: boolean, accent: string, palette: BasePalette | null): Look {
  const revision = palette?.revision ?? 0;
  if (revision !== looksRevision) {
    looks.clear();
    looksRevision = revision;
  }
  const key = `${dark}|${accent}`;
  const cached = looks.get(key);
  if (cached) return cached;
  const mode = dark ? "dark" : "light";
  const exact = (Object.keys(PROFILE_COLORS) as ProfileColor[]).find((c) => PROFILE_COLORS[c].swatch.toLowerCase() === accent.toLowerCase());
  const t = themeFor(`${exact ?? nearestPreset(accent)}:${mode}`, palette);
  const tint = exact ? t.windowTint : opaqueTint(backdropTint(tintForHue(accent), false), dark);
  const look: Look = {
    dark,
    t,
    tint,
    card: opaqueCard({ card: t.card, windowTint: tint }),
    ...mockPage[mode],
    site: toolbarPalette(t, SITE[dark ? 1 : 0]),
    plain: toolbarPalette(t, null),
  };
  looks.set(key, look);
  return look;
}

export const pick = <T,>(look: Look, pair: readonly [T, T]) => pair[look.dark ? 1 : 0];
