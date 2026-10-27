import { createContext, useContext, useMemo } from "react";
import { useSelectedTabGlowSetting } from "../../state/app/theme";
import { useShortcutHint } from "../../state/commands/commandShortcuts";
import { DEFAULT_SETTINGS } from "../../state/settings/settings";
import { selectedTabGlow, useTheme, type SelectedTabGlowLevel } from "../ui/theme";

export type SidebarRowLook = { glow: SelectedTabGlowLevel; backToPinHint: string | undefined; closeTabHint: string | undefined };

export const SidebarRowLookContext = createContext<SidebarRowLook>({ glow: DEFAULT_SETTINGS.selectedTabGlow, backToPinHint: undefined, closeTabHint: undefined });

export function useSidebarRowLookSource(): SidebarRowLook {
  const glow = useSelectedTabGlowSetting();
  const backToPinHint = useShortcutHint("returnToPinnedUrl");
  const closeTabHint = useShortcutHint("closeTab");
  return useMemo(() => ({ glow, backToPinHint, closeTabHint }), [glow, backToPinHint, closeTabHint]);
}

export const useSidebarRowLook = () => useContext(SidebarRowLookContext);

export function useSelectedTabGlow() {
  return selectedTabGlow(useTheme(), useSidebarRowLook().glow);
}
