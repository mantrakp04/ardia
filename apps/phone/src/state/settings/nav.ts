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
  | { page: "sync" }
  | { page: "defaultBrowser" }
  | { page: "syncConnect" }
  | { page: "about" }
  | { page: "licenses" }
  | { page: "whatsSent" };

type SettingsNav = { open: boolean; stack: SettingsRoute[]; popping: boolean };

export const useSettingsNav = create<SettingsNav>()(() => ({ open: false, stack: [], popping: false }));

const scrolls = new Map<string, number>();

export const rememberSettingsScroll = (page: string, y: number) => void scrolls.set(page, y);

export const settingsScroll = (page: string) => scrolls.get(page) ?? 0;

export function openSettings(route: SettingsRoute = { page: "root" }) {
  scrolls.clear();
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

export function closeSettings() {
  scrolls.clear();
  useSettingsNav.setState({ open: false, stack: [], popping: false });
}

export const settingsNav = () => useSettingsNav.getState();
