import { useColorScheme } from "react-native";
import { usePages } from "../pages/store";
import { usePreferences } from "../settings/store";
import { useTabs } from "../tabs/store";
import { menuModel, menuTitle, searchQuery, type MenuModel } from "./pageMenu";
import { usePageUi } from "./store";
import { display } from "../search/omnibox";
import type { Request } from "./pagePrompts";

export const useMenuOpen = () => usePageUi((s) => s.menuOpen);
export const useTitleFeedback = () => usePageUi((s) => s.titleFeedback);
export const useFindOpen = () => usePageUi((s) => s.findOpen);
export const useFindQuery = () => usePageUi((s) => s.findQuery);
export const useReaderTabId = () => usePageUi((s) => s.readerTabId);
export const usePress = () => usePageUi((s) => s.press);
export const usePressOpen = () => usePageUi((s) => s.press !== null);

export const useFindResult = (id: string | null) => usePages((s) => (id ? s.finds[id] ?? null : null));

export const usePageRequest = (id: string | null) => usePages((s) => (id ? (s.requests[id] as Request | null | undefined) ?? null : null));

export function useMenuModel(id: string): MenuModel {
  const dark = useColorScheme() === "dark";
  const state = usePages((s) => s.navigation[id] ?? null);
  const tabUrl = useTabs((s) => s.open.find((t) => t.id === id)?.url ?? s.privates.find((t) => t.id === id)?.url ?? "");
  const site = usePageUi((s) => s.menuSite);
  const levels = usePageUi((s) => s.zoomLevels);
  return menuModel({
    url: state?.url ?? tabUrl,
    hasPage: state !== null,
    canGoBack: state?.canGoBack ?? false,
    canGoForward: state?.canGoForward ?? false,
    isLoading: state?.isLoading ?? false,
    pageZoom: state?.pageZoom ?? 1,
    zoomLevels: levels,
    isDesktopSite: state?.isDesktopSite ?? false,
    nightShade: site?.nightShade ?? "disabled",
    systemDark: dark,
    blockersEnabled: site?.blockersEnabled ?? true,
    blockedRequests: state?.blockedRequests ?? 0,
  });
}

export function useMenuTitle(id: string): string {
  const tab = useTabs((s) => s.open.find((t) => t.id === id) ?? s.privates.find((t) => t.id === id) ?? null);
  if (!tab) return "";
  return menuTitle(tab.title, tab.url, display(tab.url).host || null, searchQuery(tab.url));
}

export const useReaderSettings = () => ({
  step: usePreferences((p) => p.readerStep),
  serif: usePreferences((p) => p.readerSerif),
  theme: usePreferences((p) => p.readerTheme),
});
