import type { ReactNode } from "react";
import { spaceLookSource } from "../../lib/profileLook";
import { useScopedLook } from "../../state/app/theme";
import { isIncognitoProfile } from "../../state/browser/model";
import { useProfileLook } from "../../state/profiles/hooks";
import { scopedTheme, ThemeContext, type Theme } from "../ui/theme";

export function ThemeScope({ children }: { children: ReactNode }) {
  const theme = useScopedLook(scopedTheme);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useProfileTheme(profileId: string): Theme {
  return useProfileLook(profileId, (profile, appDark, settings) => scopedTheme(isIncognitoProfile(profileId), profile, appDark, spaceLookSource(settings)));
}
