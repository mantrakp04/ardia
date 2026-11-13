import { create } from "zustand";
import { closePage, type PageNavigationState, type PageTone, type PageViewHandle } from "../../platform/pages";
import { resolve, type TrayRow } from "../search/omnibox";
import { dismissSearch, presentSearch } from "../search/store";

export type OpenPage = { id: string; initialUrl: string };

type BrowseState = { page: OpenPage | null; navigation: PageNavigationState | null; tone: PageTone | null };

export const useBrowse = create<BrowseState>()(() => ({ page: null, navigation: null, tone: null }));

let handle: PageViewHandle | null = null;
let pageCount = 0;

export function registerPageHandle(next: PageViewHandle | null) {
  handle = next;
}

export const updateNavigation = (navigation: PageNavigationState) => useBrowse.setState({ navigation });

export const updateTone = (tone: PageTone) => useBrowse.setState({ tone });

export function openUrl(url: string) {
  dismissSearch();
  const { page } = useBrowse.getState();
  if (page && handle) {
    void handle.loadUrl(url);
    return;
  }
  pageCount += 1;
  useBrowse.setState({ page: { id: `page-${Date.now()}-${pageCount}`, initialUrl: url }, navigation: null, tone: null });
}

export function submitSearch(text: string) {
  const resolution = resolve(text);
  if (resolution) openUrl(resolution.url);
}

export function activateRow(row: TrayRow) {
  if (row.kind === "calc") return;
  openUrl(row.url);
}

export function editPageAddress() {
  presentSearch("page", useBrowse.getState().navigation?.url ?? "");
}

export const goBack = () => handle?.goBack() ?? Promise.resolve(false);
export const goForward = () => handle?.goForward() ?? Promise.resolve(false);
export const reload = () => handle?.reload();
export const stopLoading = () => handle?.stopLoading();

export function closeCurrentPage() {
  const { page } = useBrowse.getState();
  if (!page) return;
  useBrowse.setState({ page: null, navigation: null, tone: null });
  void closePage(page.id);
}

export function handleSystemBack(): boolean {
  const { page, navigation } = useBrowse.getState();
  if (!page) return false;
  if (navigation?.canGoBack) {
    void goBack();
    return true;
  }
  closeCurrentPage();
  return true;
}
