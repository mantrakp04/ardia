import { create } from "zustand";
import { useBrowser } from "../../store/browser";

type ThemePanelState = { open: Record<string, string> };

export const useThemePanel = create<ThemePanelState>()(() => ({ open: {} }));

export function openThemePanel(windowId: string) {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  const target = w?.profileId;
  if (!w || w.incognito || w.kind === "small" || !target || !s.profiles[target]) return;
  useThemePanel.setState((s) => ({ open: { ...s.open, [windowId]: target } }));
}

export function closeThemePanel(windowId: string) {
  useThemePanel.setState((s) => {
    const { [windowId]: _, ...open } = s.open;
    return { open };
  });
}

export function closeThemePanelIn(windowId: string | undefined): boolean {
  if (!windowId || !useThemePanel.getState().open[windowId]) return false;
  closeThemePanel(windowId);
  return true;
}

export function toggleThemePanel(windowId: string) {
  if (useThemePanel.getState().open[windowId]) closeThemePanel(windowId);
  else openThemePanel(windowId);
}
