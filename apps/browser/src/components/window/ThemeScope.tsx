import { useMemo, type ReactNode } from "react";
import { spaceLookSource } from "../../lib/profileLook";
import { useGlassSettings, useScopedLook } from "../../state/app/theme";
import { isIncognitoSpace } from "../../state/browser/model";
import { useProfileLook } from "../../state/spaces/hooks";
import { GlassLookContext, liquidGlass } from "../ui/Glass";
import { scopedTheme, ThemeContext, type Theme } from "../ui/theme";

export function ThemeScope({ children }: { children: ReactNode }) {
  const theme = useScopedLook(scopedTheme);
  const { glass, panes, tint } = useGlassSettings();
  const look = useMemo(() => ({ controls: liquidGlass && glass, panes: liquidGlass && glass && panes, tint }), [glass, panes, tint]);
  return (
    <ThemeContext.Provider value={theme}>
      <GlassLookContext.Provider value={look}>{children}</GlassLookContext.Provider>
    </ThemeContext.Provider>
  );
}

export function useProfileTheme(spaceId: string): Theme {
  return useProfileLook(spaceId, (space, appDark, settings) => scopedTheme(isIncognitoSpace(spaceId), space, appDark, spaceLookSource(settings)));
}
