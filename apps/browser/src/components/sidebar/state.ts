import type { View } from "react-native";
import { create } from "zustand";

export type Anchor = { x: number; y: number; width: number; height: number };
export type Target = { kind: "tab" | "group" | "live" | "folder"; id: string };
export type Hover = Target & { windowId: string; anchor: Anchor; layout: number };

type SidebarUi = {
  renaming: (Target & { windowId: string }) | null;
  iconPicker: (Target & { windowId: string; anchor: Anchor | null }) | null;
  hover: Hover | null;
  searchTabs: string | null;
  switcher: { windowId: string; ids: string[]; index: number; visible: boolean } | null;
  dragWidth: Record<string, number>;
};

export const useSidebarUi = create<SidebarUi>()(() => ({
  renaming: null,
  iconPicker: null,
  hover: null,
  searchTabs: null,
  switcher: null,
  dragWidth: {},
}));

export const sidebarUi = () => useSidebarUi.getState();
export const setSidebarUi = (patch: Partial<SidebarUi>) => useSidebarUi.setState(patch);

const rows = new Map<string, Map<string, View>>();

export function registerRow(windowId: string, id: string, view: View | null) {
  let byId = rows.get(windowId);
  if (!byId) rows.set(windowId, (byId = new Map()));
  if (view) byId.set(id, view);
  else byId.delete(id);
}

export const rowIds = (windowId: string): string[] => [...(rows.get(windowId)?.keys() ?? [])];

export function rowView(windowId: string, id: string): View | undefined {
  return rows.get(windowId)?.get(id);
}

export function measureRow(windowId: string, id: string): Promise<Anchor | null> {
  const view = rowView(windowId, id);
  if (!view) return Promise.resolve(null);
  return new Promise((resolve) => view.measureInWindow((x, y, width, height) => resolve(width && rowView(windowId, id) === view ? { x, y, width, height } : null)));
}

const layouts = new Map<string, number>();
export const hoverLayout = (windowId: string) => layouts.get(windowId) ?? 0;
export const moveHoverLayout = (windowId: string) => void layouts.set(windowId, hoverLayout(windowId) + 1);

export async function measureForHover(windowId: string, id: string): Promise<{ anchor: Anchor; layout: number } | null> {
  const layout = hoverLayout(windowId);
  const anchor = await measureRow(windowId, id);
  return anchor && layout === hoverLayout(windowId) ? { anchor, layout } : null;
}
