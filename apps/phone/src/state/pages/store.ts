import { create } from "zustand";
import { closePage, pages, type PageEngineEvent, type PageNavigationState, type PageSnapshot, type PageTone, type PageViewHandle } from "../../platform/pages";

export type { PageEngineEvent, PageNavigationState, PageSnapshot, PageTone, PageViewHandle };

type PagesState = { navigation: Record<string, PageNavigationState>; tones: Record<string, PageTone> };

export const usePages = create<PagesState>()(() => ({ navigation: {}, tones: {} }));

const handles = new Map<string, PageViewHandle>();

export function registerPageHandle(id: string, handle: PageViewHandle | null) {
  if (handle) handles.set(id, handle);
  else handles.delete(id);
}

export const pageHandle = (id: string | null) => (id ? handles.get(id) ?? null : null);

export const pageNavigation = (id: string | null) => (id ? usePages.getState().navigation[id] ?? null : null);

export const pageTone = (id: string) => usePages.getState().tones[id] ?? null;

export const storeNavigation = (id: string, navigation: PageNavigationState) =>
  usePages.setState((s) => ({ navigation: { ...s.navigation, [id]: navigation } }));

export const storeTone = (id: string, tone: PageTone) => usePages.setState((s) => ({ tones: { ...s.tones, [id]: tone } }));

export function endPages(ids: readonly string[]) {
  if (!ids.length) return;
  usePages.setState((s) => {
    const navigation = { ...s.navigation };
    const tones = { ...s.tones };
    for (const id of ids) {
      delete navigation[id];
      delete tones[id];
    }
    return { navigation, tones };
  });
  for (const id of ids) {
    handles.delete(id);
    void closePage(id);
  }
}

export function deletePageSnapshots(ids: readonly string[]) {
  for (const id of ids) void pages.deleteSnapshots(id);
}

export const endPrivateSession = () => void pages.endPrivateSession();

export const snapshotPage = (id: string): Promise<PageSnapshot | null> => pages.snapshot(id, { maxWidth: 600, quality: 72 }).catch(() => null);

export const savePageState = (id: string): Promise<string | null> => pages.saveState(id).catch(() => null);

export const livePageIds = (): Promise<string[]> => pages.ids().catch(() => []);

export const listenToPages = (listener: (event: PageEngineEvent) => void) => pages.addListener(listener);
