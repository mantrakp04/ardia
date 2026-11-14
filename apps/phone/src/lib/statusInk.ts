import { luminance, mixColors } from "./color.ts";

export type InkLayer = "cover" | "voice" | "sheet" | "search" | "deck" | "page";

export type InkScene = { onboarding: boolean; voice: boolean; sheet: boolean; searching: boolean; surface: "start" | "deck" | "browsing" };

export function inkLayer(scene: InkScene): InkLayer {
  if (scene.onboarding) return "cover";
  if (scene.voice) return "voice";
  if (scene.sheet) return "sheet";
  if (scene.searching || scene.surface === "start") return "search";
  if (scene.surface === "deck") return "deck";
  return "page";
}

const SCRIM_ALPHA = 0.25;
const CONTRAST_MIDPOINT = 0.179;

const isLight = (color: string) => luminance(color) > CONTRAST_MIDPOINT;

export type InkColors = { cover: string; surface: string; deck: string; incognito: boolean };

export function lightStatusIcons(layer: InkLayer, colors: InkColors): boolean | null {
  switch (layer) {
    case "page":
      return null;
    case "voice":
      return true;
    case "cover":
      return !isLight(colors.cover);
    case "sheet":
      return !isLight(mixColors(colors.surface, "#000000", SCRIM_ALPHA));
    case "search":
      return colors.incognito || !isLight(colors.surface);
    case "deck":
      return !isLight(colors.deck);
  }
}
