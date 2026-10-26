import { create } from "zustand";

export const usePersonalizePanel = create<{ windowId: string | null }>()(() => ({ windowId: null }));

export const setPersonalizePanel = (windowId: string | null) => usePersonalizePanel.setState({ windowId });

export function closePersonalizePanelOf(windowId: string) {
  if (usePersonalizePanel.getState().windowId === windowId) setPersonalizePanel(null);
}
