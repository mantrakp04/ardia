import { create } from "zustand";
import {
  closePage,
  pages,
  type FindResult,
  type PageEngineEvent,
  type PageNavigationState,
  type PageRequest,
  type PageScrollPosition,
  type PageSnapshot,
  type PageState,
  type PageTone,
  type PageViewHandle,
} from "../../platform/pages";

export type { FindResult, PageEngineEvent, PageNavigationState, PageRequest, PageScrollPosition, PageSnapshot, PageState, PageTone, PageViewHandle };

type PagesState = {
  navigation: Record<string, PageState>;
  tones: Record<string, PageTone>;
  finds: Record<string, FindResult | null>;
  requests: Record<string, PageRequest | null>;
  fullscreen: Record<string, boolean>;
};

export const usePages = create<PagesState>()(() => ({ navigation: {}, tones: {}, finds: {}, requests: {}, fullscreen: {} }));

const handles = new Map<string, PageViewHandle>();

export function registerPageHandle(id: string, handle: PageViewHandle | null) {
  if (handle) handles.set(id, handle);
  else handles.delete(id);
}

export const pageHandle = (id: string | null) => (id ? handles.get(id) ?? null : null);

export const pageNavigation = (id: string | null) => (id ? usePages.getState().navigation[id] ?? null : null);

export const pageTone = (id: string) => usePages.getState().tones[id] ?? null;

export const storeNavigation = (id: string, navigation: PageState) =>
  usePages.setState((s) => ({ navigation: { ...s.navigation, [id]: navigation } }));

export const storeTone = (id: string, tone: PageTone) => usePages.setState((s) => ({ tones: { ...s.tones, [id]: tone } }));

export const storeFind = (id: string, result: FindResult | null) => usePages.setState((s) => ({ finds: { ...s.finds, [id]: result } }));

export const storeRequest = (id: string, request: PageRequest | null) => usePages.setState((s) => ({ requests: { ...s.requests, [id]: request } }));

export const storeFullscreen = (id: string, on: boolean) => usePages.setState((s) => ({ fullscreen: { ...s.fullscreen, [id]: on } }));

export const pageRequest = (id: string | null) => (id ? usePages.getState().requests[id] ?? null : null);

export const pageIsFullscreen = (id: string | null) => (id ? usePages.getState().fullscreen[id] ?? false : false);

export function endPages(ids: readonly string[]) {
  if (!ids.length) return;
  usePages.setState((s) => {
    const navigation = { ...s.navigation };
    const tones = { ...s.tones };
    const finds = { ...s.finds };
    const requests = { ...s.requests };
    const fullscreen = { ...s.fullscreen };
    for (const id of ids) {
      delete navigation[id];
      delete tones[id];
      delete finds[id];
      delete requests[id];
      delete fullscreen[id];
    }
    return { navigation, tones, finds, requests, fullscreen };
  });
  for (const id of ids) {
    handles.delete(id);
    void closePage(id);
  }
}

export const settled = <T>(call: () => Promise<T>, fallback: T): Promise<T> =>
  Promise.resolve()
    .then(call)
    .catch(() => fallback);

export function deletePageSnapshots(ids: readonly string[]) {
  for (const id of ids) void settled(() => pages.deleteSnapshots(id), undefined);
}

export const endPrivateSession = () => void settled(() => pages.endPrivateSession(), undefined);

export const snapshotPage = (id: string): Promise<PageSnapshot | null> => settled(() => pages.snapshot(id, { maxWidth: 600, quality: 72 }), null);

export const savePageState = (id: string): Promise<string | null> => settled(() => pages.saveState(id), null);

export const pageScrollPosition = (id: string): Promise<PageScrollPosition | null> => settled(() => pages.scrollPosition(id), null);

export const openPageInBackground = (id: string, url: string, isPrivate: boolean) => settled(() => pages.open(id, { url, isPrivate }), undefined);

export const livePageIds = (): Promise<string[]> => settled(() => pages.ids(), []);

export function listenToPages(listener: (event: PageEngineEvent) => void) {
  try {
    return pages.addListener(listener);
  } catch {
    return null;
  }
}
