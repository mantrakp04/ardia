import { create } from "zustand";

export type SettingsRoute =
  | { page: "root" }
  | { page: "searchEngine" }
  | { page: "siteSettings" }
  | { page: "filterLists" }
  | { page: "filterList"; id: string }
  | { page: "myFilters" }
  | { page: "trustedSites" }
  | { page: "clearData" }
  | { page: "downloads" }
  | { page: "about" }
  | { page: "licenses" };

type SettingsNav = { open: boolean; stack: SettingsRoute[]; popping: boolean };

export const useSettingsNav = create<SettingsNav>()(() => ({ open: false, stack: [], popping: false }));

export function openSettings(route: SettingsRoute = { page: "root" }) {
  const stack: SettingsRoute[] = route.page === "root" ? [route] : [{ page: "root" }, route];
  useSettingsNav.setState({ open: true, stack, popping: false });
}

export const pushSettings = (route: SettingsRoute) => useSettingsNav.setState((s) => ({ stack: [...s.stack, route], popping: false }));

export function popSettings(): boolean {
  const { open, stack } = useSettingsNav.getState();
  if (!open) return false;
  if (stack.length <= 1) closeSettings();
  else useSettingsNav.setState({ stack: stack.slice(0, -1), popping: true });
  return true;
}

export const closeSettings = () => useSettingsNav.setState({ open: false, stack: [], popping: false });

export const settingsNav = () => useSettingsNav.getState();
