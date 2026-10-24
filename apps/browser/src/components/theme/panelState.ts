import { create } from "zustand";
import { useBrowser } from "../../store/browser";

type ThemePanelState = { open: Record<string, string> };

export const useThemePanel = create<ThemePanelState>()(() => ({ open: {} }));

export function openThemePanel(windowId: string, profileId?: string) {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  const target = profileId ?? w?.profileId;
  if (!w || w.incognito || !target || !s.profiles[target]) return;
  useThemePanel.setState((s) => ({ open: { ...s.open, [windowId]: target } }));
}

export function closeThemePanel(windowId: string) {
  useThemePanel.setState((s) => {
    const { [windowId]: _, ...open } = s.open;
    return { open };
  });
}

export function toggleThemePanel(windowId: string) {
  if (useThemePanel.getState().open[windowId]) closeThemePanel(windowId);
  else openThemePanel(windowId);
}
