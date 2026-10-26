import type { ReactNode } from "react";
import { useScopedLook } from "../../state/app/theme";
import { scopedTheme, ThemeContext } from "../ui/theme";

export function ThemeScope({ children }: { children: ReactNode }) {
  const theme = useScopedLook(scopedTheme);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
