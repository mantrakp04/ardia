import type { PageNavigationState, PageState } from "./pageTypes";

type NativeState = Omit<PageNavigationState, "url"> & { url?: string | null } & Partial<Omit<PageState, keyof PageNavigationState>>;

export const normalizeState = (state: NativeState, isPrivate: boolean): PageState => ({
  url: state.url ?? null,
  title: state.title,
  progress: state.progress,
  isLoading: state.isLoading,
  canGoBack: state.canGoBack,
  canGoForward: state.canGoForward,
  faviconUrl: state.faviconUrl ?? null,
  themeColor: state.themeColor ?? null,
  backgroundColor: state.backgroundColor ?? null,
  security: state.security ?? "none",
  failure: state.failure ?? null,
  pageZoom: state.pageZoom ?? 1,
  isDesktopSite: state.isDesktopSite ?? false,
  scrollDirection: state.scrollDirection ?? "up",
  isScrolledToTop: state.isScrolledToTop ?? true,
  blockedRequests: state.blockedRequests ?? 0,
  isLive: state.isLive ?? true,
  isPrivate: state.isPrivate ?? isPrivate,
});
