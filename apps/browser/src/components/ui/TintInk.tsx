import type { ReactNode } from "react";
import { ThemeContext, tintTheme, useTheme } from "./theme";

export function TintInk({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={tintTheme(useTheme())}>{children}</ThemeContext.Provider>;
}
