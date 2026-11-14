import { create } from "zustand";
import type { BasePalette } from "../../lib/themeFile";
import { DEFAULT_LOOK, type LookBlocks, type ThemeLook } from "../../lib/themeLook";

export const useBasePalette = create<{ palette: BasePalette | null; theme: string | null; look: ThemeLook; blocks: LookBlocks | null }>()(() => ({
  palette: null,
  theme: null,
  look: DEFAULT_LOOK,
  blocks: null,
}));

export const currentBasePalette = (): BasePalette | null => useBasePalette.getState().palette;

export const currentThemeLook = () => {
  const { theme, blocks } = useBasePalette.getState();
  return { theme, blocks };
};
