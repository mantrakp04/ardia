import { CastMode, closeCastDialog, onCastDialog, onCastRoutes, showCastDialog, watchCastRoutes, type CastDialog, type CastRoute } from "../../platform/media";
import { create } from "zustand";
import { useBrowser, type BrowserState } from "../browser/store";
import { engineProfile, engineProfileForSpace } from "../browser/model";
import { shownPageId } from "../peek/peek";
import { isTabReady } from "../tabs/pageState";

export { CastMode, startCasting, stopCasting, terminateCastRoute, type CastRoute, type CastSink } from "../../platform/media";

export function preferredCastMode(modes: number): number {
  for (const mode of [CastMode.presentation, CastMode.tab, CastMode.screen, CastMode.remotePlayback]) if (modes & mode) return mode;
  return 0;
}

type CastStore = {
  dialogs: Record<string, CastDialog>;
  routes: Record<string, CastRoute[]>;
};

export const useCast = create<CastStore>()(() => ({ dialogs: {}, routes: {} }));
if (__DEV__) (globalThis as { acCast?: unknown }).acCast = { useCast };

function castSpace(s: BrowserState, windowId: string): string {
  const w = s.windows[windowId];
  return !w ? "" : engineProfile(s, w.spaceId);
}

let started = false;
export function startCast() {
  if (started) return;
  started = true;
  onCastDialog((dialog) => {
    const tabId = dialog.tabId;
    if (!tabId) {
      if (dialog.open) void closeCastDialog(dialog.id);
      return;
    }
    useCast.setState((c) => {
      const dialogs = { ...c.dialogs };
      if (dialog.open) dialogs[tabId] = dialog;
      else if (dialogs[tabId]?.id === dialog.id) delete dialogs[tabId];
      return { dialogs };
    });
  });
  onCastRoutes(({ profile: space, routes }) => useCast.setState((c) => ({ routes: { ...c.routes, [space]: routes } })));
  const watched = new Set<string>();
  const watch = (s: BrowserState) => {
    for (const id of s.windowOrder) {
      const space = castSpace(s, id);
      if (watched.has(space)) continue;
      watched.add(space);
      void watchCastRoutes(space);
    }
  };
  watch(useBrowser.getState());
  useBrowser.subscribe((s, prev) => {
    if (s.windowOrder !== prev.windowOrder) watch(s);
  });
}

export async function toggleCastPicker(windowId: string, tabId = shownPageId(useBrowser.getState(), windowId)) {
  if (!tabId) return;
  const open = useCast.getState().dialogs[tabId];
  if (open) return closeCastPicker(tabId);
  if (isTabReady(tabId)) await showCastDialog(tabId);
}

export function closeCastPicker(tabId: string) {
  const dialog = useCast.getState().dialogs[tabId];
  if (dialog) void closeCastDialog(dialog.id);
}

const NONE: CastRoute[] = [];
export function useCastRoutes(windowId: string): CastRoute[] {
  const space = useBrowser((s) => castSpace(s, windowId));
  return useCast((c) => c.routes[space] ?? NONE);
}
