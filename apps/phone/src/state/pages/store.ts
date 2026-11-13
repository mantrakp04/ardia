import { create } from "zustand";
import { closePage, type PageNavigationState, type PageTone, type PageViewHandle } from "../../platform/pages";

export type { PageNavigationState, PageTone, PageViewHandle };

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
