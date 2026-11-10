import type { ReactNode } from "react";
import { sidebarTheme, ThemeContext, useTheme } from "../ui/theme";

export function SidebarInk({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={sidebarTheme(useTheme())}>{children}</ThemeContext.Provider>;
}
