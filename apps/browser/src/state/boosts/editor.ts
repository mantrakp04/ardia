import { create } from "zustand";
import { clearBoostPreview } from "../../platform/boosts";
import { orWarn } from "../../lib/fallback";
import { dropPendingPreview } from "../boostUi/preview";

export type BoostEditor = { tabId: string; boostId: string };

const useBoostEditors = create<{ byWindow: Record<string, BoostEditor> }>()(() => ({ byWindow: {} }));

export function openBoostEditor(windowId: string, tabId: string, boostId: string) {
  const open = useBoostEditors.getState().byWindow[windowId];
  if (open && open.tabId !== tabId) {
    dropPendingPreview(open.tabId);
    void clearBoostPreview(open.tabId).catch(orWarn(undefined));
  }
  useBoostEditors.setState((s) => ({ byWindow: { ...s.byWindow, [windowId]: { tabId, boostId } } }));
}

export function closeBoostEditor(windowId: string) {
  const open = useBoostEditors.getState().byWindow[windowId];
  if (!open) return;
  const { [windowId]: _, ...rest } = useBoostEditors.getState().byWindow;
  useBoostEditors.setState({ byWindow: rest });
  dropPendingPreview(open.tabId);
  void clearBoostPreview(open.tabId).catch(orWarn(undefined));
}

export const useBoostEditor = (windowId: string): BoostEditor | null => useBoostEditors((s) => s.byWindow[windowId]) ?? null;
