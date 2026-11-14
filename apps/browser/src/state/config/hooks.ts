import type { BasePalette } from "../../lib/themeFile";
import type { ThemeLook } from "../../lib/themeLook";
import { useBasePalette } from "./basePalette";

export const useBasePaletteValue = (): BasePalette | null => useBasePalette((s) => s.palette);

export const useThemeLook = (): ThemeLook => useBasePalette((s) => s.look);
