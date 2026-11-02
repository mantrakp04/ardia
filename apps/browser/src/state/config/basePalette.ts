import { create } from "zustand";
import type { BasePalette } from "../../lib/themeFile";

export const useBasePalette = create<{ palette: BasePalette | null; theme: string | null }>()(() => ({ palette: null, theme: null }));

export const currentBasePalette = (): BasePalette | null => useBasePalette.getState().palette;
