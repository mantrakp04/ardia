import type {
  AutofillPrompt,
  BlockedPopup,
  CrashInfo,
  MediaAccess,
  NavigationState,
  PageEngine,
  PasswordPrompt,
  SecurityInfo,
} from "../../platform/tabs";
import type { ExternalAppRequest } from "../../platform/siteSettings";
import type { PermissionRequest } from "../../platform/permissions";
import { create } from "zustand";
import { useBrowser } from "../browser/store";
import { activeTabId } from "../browser/model";
import { peekTabId } from "../peek/peek";
import { splitOf, splitTabIdsOf } from "../splits/splits";

export type { AutofillPrompt, AutofillPromptAnswer, PasswordPrompt, PasswordPromptAnswer } from "../../platform/tabs";

export type PageState = {
  status: string;
  crashed: CrashInfo | null;
  unresponsive: boolean;
  fullscreen: boolean;
  security: SecurityInfo | null;
  blocked: number;
  themeColorSource: NavigationState["themeColorSource"];
  popups: BlockedPopup[];
  permission: PermissionRequest | null;
  passwordPrompt: PasswordPrompt | null;
  autofillPrompt: AutofillPrompt | null;
  externalApp: ExternalAppRequest | null;
  mediaAccess: MediaAccess | null;
  wasNewTab: boolean;
  backToNewTab: boolean;
  engineBack: { engine: PageEngine; url: string } | null;
  newTabShown: { url: string; title: string; favicon: string | null } | null;
};

const IDLE_PAGE: PageState = {
  status: "",
  crashed: null,
  unresponsive: false,
  fullscreen: false,
  security: null,
  blocked: 0,
  themeColorSource: null,
  popups: [],
  permission: null,
  passwordPrompt: null,
  autofillPrompt: null,
  externalApp: null,
  mediaAccess: null,
  wasNewTab: false,
  backToNewTab: false,
  engineBack: null,
  newTabShown: null,
};

type Store = {
  pages: Record<string, PageState>;
  ready: Record<string, number>;
  popover: Record<string, "siteControls" | "popups" | "zoom" | null>;
};

export const usePages = create<Store>()(() => ({ pages: {}, ready: {}, popover: {} }));

export function patchPage(tabId: string, patch: Partial<PageState>) {
  usePages.setState((s) => {
    const current = s.pages[tabId] ?? IDLE_PAGE;
    for (const key in patch) {
      if (!Object.is(current[key as keyof PageState], patch[key as keyof PageState])) {
        return { pages: { ...s.pages, [tabId]: { ...current, ...patch } } };
      }
    }
    return s;
  });
}

export const pageOf = (tabId: string | undefined): PageState => (tabId && usePages.getState().pages[tabId]) || IDLE_PAGE;

const iconPages = new Map<string, string | null>();

export const iconPageOf = (tabId: string): string | null => iconPages.get(tabId) ?? null;

export const setIconPage = (tabId: string, page: string | null) => void iconPages.set(tabId, page);

export function usePage<T>(tabId: string | undefined, select: (p: PageState) => T): T {
  return usePages((s) => select((tabId && s.pages[tabId]) || IDLE_PAGE));
}

let readiness = 0;

export function markTabReady(tabId: string) {
  usePages.setState((s) => ({ ready: { ...s.ready, [tabId]: ++readiness } }));
}

export const isTabReady = (tabId: string | null | undefined): tabId is string => !!tabId && !!usePages.getState().ready[tabId];

export const popoverOf = (tabId: string) => usePages.getState().popover[tabId];

export function setPopover(tabId: string, popover: Store["popover"][string]) {
  usePages.setState((s) => ({ popover: { ...s.popover, [tabId]: popover } }));
}

export function useFullscreenTab(windowId: string): string | undefined {
  const fullscreen = usePages((s) => {
    let ids = "";
    for (const id in s.pages) if (s.pages[id]!.fullscreen) ids += `${id}\n`;
    return ids;
  });
  return useBrowser((s) => {
    if (!fullscreen) return undefined;
    const active = activeTabId(s, windowId);
    const peek = peekTabId(s, windowId);
    const shown = [...(peek ? [peek] : []), ...(active ? (splitTabIdsOf(splitOf(s, active)) ?? [active]) : [])];
    return shown.find((id) => fullscreen.split("\n").includes(id));
  });
}

useBrowser.subscribe((s, prev) => {
  if (s.tabs === prev.tabs) return;
  for (const id of iconPages.keys()) if (!s.tabs[id]) iconPages.delete(id);
  const { pages, ready, popover } = usePages.getState();
  const stale = (ids: string[], tabOf: (id: string) => string) => {
    for (let i = 0; i < ids.length; i++) if (!s.tabs[tabOf(ids[i]!)]) return true;
    return false;
  };
  const pageIds = Object.keys(pages);
  const readyIds = Object.keys(ready);
  if (!stale(pageIds, (id) => id) && !stale(readyIds, (id) => id)) return;
  const gone = pageIds.filter((id) => !s.tabs[id]);
  const goneReady = readyIds.filter((id) => !s.tabs[id]);
  const nextPages = { ...pages };
  const nextPopover = { ...popover };
  for (const id of gone) {
    delete nextPages[id];
    delete nextPopover[id];
  }
  const nextReady = { ...ready };
  for (const id of goneReady) delete nextReady[id];
  usePages.setState({ pages: nextPages, ready: nextReady, popover: nextPopover });
});
