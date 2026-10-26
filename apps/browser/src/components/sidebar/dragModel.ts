import { Animated, type View } from "react-native";
import { layout } from "../ui/theme";
import type { Drop as StoreDrop } from "../../state/drag/drops";
import { SLIDE } from "../tabstrip/stripReorder";
import { TILE_GAP } from "./pinZone";
import { folderIdOfCell } from "../../state/pins/tileFolders";

export type Frame = { x: number; y: number; w: number; h: number };
export type Section = "tiles" | "pinnedRows" | "pinnedGroups" | "list" | "folder";

export type ItemSpec = {
  kind: "tile" | "row" | "group" | "split" | "tail" | "live";
  tabIds: string[];
  section: Section;
  groupId?: string;
  parentGroup?: string;
  collapsed?: boolean;
  foldedHeight?: () => number;
  liveFolderId?: string;
  folderId?: string;
};

export type Item = ItemSpec & {
  key: string;
  view: View | null;
  header: View | null;
  gap: Animated.Value;
  size: Animated.Value;
  frame: Frame | null;
  headerFrame: Frame | null;
};

export type Drop = StoreDrop & { sequence?: string[] };

export const blockKind = (i: Item) => i.kind === "row" || i.kind === "group" || i.kind === "live" || i.kind === "split";
export const pinnedBlock = (i: Item) => (i.section === "pinnedRows" || i.section === "pinnedGroups") && !i.parentGroup && blockKind(i);
export const boxed = (i: Item) => i.kind === "group" || i.kind === "live";
export const apart = (a: Item, b: Item) => a.section !== b.section && (a.section === "folder" || b.section === "folder");
export const cellKey = (cell: string) => {
  const folderId = folderIdOfCell(cell);
  return folderId ? `tf:${folderId}` : `t:${cell}`;
};

export type Ghost = { item: Item; count: number; width: number; height: number; position: Animated.ValueXY; landing?: boolean };

export const ROW_GAP = layout.rowGap;
export const RESTING_TAIL = { marginTop: -ROW_GAP };
export const PIN_SLOT = layout.pinnedHeight + TILE_GAP;
export const EDGE = 28;
export const FOLDER_HOLD_MS = 400;
export const spring = (value: Animated.Value, toValue: number) => Animated.spring(value, { toValue, ...SLIDE });

export const inside = (f: Frame, x: number, y: number, slop = 0) => x >= f.x - slop && x <= f.x + f.w + slop && y >= f.y - slop && y <= f.y + f.h + slop;
export const measure = (view: View | null): Promise<Frame | null> =>
  view
    ? new Promise((resolve) => view.measureInWindow((x, y, w, h) => resolve(w || h ? { x, y, w, h } : null)))
    : Promise.resolve(null);

export type Pointed = { cell: Item | null; index: number; gap: number; part: "gap" | "centre" | "before" | "after" };
