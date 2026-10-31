import { useContext } from "react";
import { spaceLookSource, type LookSource } from "../../lib/profileLook";
import { PageSpaceContext, WindowContext } from "../browser/hooks";
import { useBrowser } from "../browser/store";
import type { Space } from "../browser/types";
import { focusedWindowOf } from "../windows/ui";

export function useScopedLook<T>(resolve: (incognito: boolean, profile: Space | undefined, appDark: boolean, source: LookSource) => T): T {
  const windowId = useContext(WindowContext);
  const page = useContext(PageSpaceContext);
  return useBrowser((s) => {
    const w = s.windows[windowId ?? focusedWindowOf(s) ?? ""];
    if (w?.kind === "private") return resolve(true, undefined, s.ui.appDark, "own");
    return resolve(false, s.spaces[page ?? w?.spaceId ?? s.settings.defaultSpaceId], s.ui.appDark, windowId ? spaceLookSource(s.settings) : "utility");
  });
}

export function useGlassSettings() {
  const glass = useBrowser((s) => s.settings.interfaceStyle === "glass");
  const panes = useBrowser((s) => s.settings.glassPanes);
  const tint = useBrowser((s) => (s.settings.glassTintWithTheme ? s.settings.glassTintAmount : 0));
  return { glass, panes, tint };
}

export function useSelectedTabGlowSetting() {
  return useBrowser((s) => s.settings.selectedTabGlow);
}
