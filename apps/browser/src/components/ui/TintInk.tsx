import type { ReactNode } from "react";
import { useSiteGround } from "./siteGround";
import { siteGroundTheme, ThemeContext, tintTheme, useTheme } from "./theme";

export function TintInk({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={tintTheme(siteGroundTheme(useTheme(), useSiteGround()))}>{children}</ThemeContext.Provider>;
}
