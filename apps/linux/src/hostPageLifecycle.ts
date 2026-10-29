import { patchPage, setPopover, usePages } from "../../browser/src/state/tabs/pageState";
import { useBrowser } from "../../browser/src/state/browser/store";
import { updateLive } from "../../browser/src/state/tabs/actions";
import { revealToolbar } from "../../browser/src/state/windows/toolbarAutoHide";
import type { NavigationState } from "../../../packages/ardiacore/src/pageTypes";

import type { PageState } from "../../browser/src/state/tabs/pageState";

export type PageResetReason = "mount" | "document" | "provisional" | "snapshot" | "restore";

const RESTORED: Record<string, Partial<PageState>> = {
  security: { security: null },
  navigation: { themeColorSource: null },
  popupBlocked: { popups: [] },
  status: { status: "" },
  crashed: { crashed: null },
  unresponsive: { unresponsive: false },
  responsive: { unresponsive: false },
  fullscreen: { fullscreen: false },
  contentBlocked: { blocked: 0 },
  passwordPrompt: { passwordPrompt: null },
  autofillPrompt: { autofillPrompt: null },
  mediaAccess: { mediaAccess: null },
};

export function resetHostPage(tabId: string, reason: PageResetReason, replaced: ReadonlySet<string> = new Set()) {
  if (reason === "mount") keepMountedPage(tabId);
  if (reason === "provisional" || reason === "restore") {
    const kinds = reason === "provisional" ? new Set(["security", "navigation"]) : replaced;
    const patch: Partial<PageState> = {};
    for (const kind of kinds) Object.assign(patch, RESTORED[kind]);
    patchPage(tabId, patch);
    if (kinds.has("navigation")) updateLive(tabId, { themeColor: null });
    return;
  }
  patchPage(tabId, {
    security: null,
    themeColorSource: null,
    popups: [],
    status: "",
    crashed: null,
    unresponsive: false,
    fullscreen: false,
    blocked: 0,
    passwordPrompt: null,
    autofillPrompt: null,
  });
  setPopover(tabId, null);
  updateLive(tabId, { themeColor: null });
  revealToolbar(tabId);
}

type DepartureStore = Pick<typeof useBrowser, "getState" | "subscribe">;

const pendingDepartures = new Map<string, () => void>();

const departed = (state: ReturnType<typeof useBrowser.getState>, tabId: string, windowId: string) => state.tabs[tabId]?.windowId !== windowId;

function dropPage(tabId: string) {
  usePages.setState((s) => {
    if (!(tabId in s.pages) && !(tabId in s.popover) && !(tabId in s.ready)) return s;
    const { [tabId]: _page, ...pages } = s.pages;
    const { [tabId]: _popover, ...popover } = s.popover;
    const { [tabId]: _ready, ...ready } = s.ready;
    return { pages, popover, ready };
  });
}

export function keepMountedPage(tabId: string) {
  pendingDepartures.get(tabId)?.();
}

export function forgetDepartedPage(tabId: string, windowId: string, store: DepartureStore = useBrowser) {
  keepMountedPage(tabId);
  if (departed(store.getState(), tabId, windowId)) return dropPage(tabId);
  const stop = store.subscribe((state) => {
    if (!departed(state, tabId, windowId)) return;
    cancel();
    dropPage(tabId);
  });
  const cancel = () => {
    stop();
    if (pendingDepartures.get(tabId) === cancel) pendingDepartures.delete(tabId);
  };
  pendingDepartures.set(tabId, cancel);
}

export function applyHostPageTheme(tabId: string, navigation: NavigationState) {
  updateLive(tabId, { themeColor: navigation.themeColor });
  patchPage(tabId, { themeColorSource: navigation.themeColorSource });
}
