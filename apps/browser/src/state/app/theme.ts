import { useContext } from "react";
import { spaceLookSource, type LookSource } from "../../lib/profileLook";
import { PageProfileContext, WindowContext } from "../browser/hooks";
import { useBrowser } from "../browser/store";
import type { Profile } from "../browser/types";

export function useScopedLook<T>(resolve: (incognito: boolean, profile: Profile | undefined, appDark: boolean, source: LookSource) => T): T {
  const windowId = useContext(WindowContext);
  const page = useContext(PageProfileContext);
  return useBrowser((s) => {
    const w = s.windows[windowId ?? s.ui.focusedWindowId ?? ""];
    if (w?.incognito) return resolve(true, undefined, s.ui.appDark, "own");
    return resolve(false, s.profiles[page ?? w?.profileId ?? s.settings.defaultProfileId], s.ui.appDark, windowId ? spaceLookSource(s.settings) : "utility");
  });
}

export function useSelectedTabGlowSetting() {
  return useBrowser((s) => s.settings.selectedTabGlow);
}
