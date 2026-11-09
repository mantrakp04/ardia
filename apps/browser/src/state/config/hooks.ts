import type { BasePalette } from "../../lib/themeFile";
import { useBasePalette } from "./basePalette";

export const useBasePaletteValue = (): BasePalette | null => useBasePalette((s) => s.palette);
