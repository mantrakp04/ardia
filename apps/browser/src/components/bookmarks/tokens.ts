import { duration } from "../ui/motion";
import { capsule, radius, space } from "../ui/tokens";

export const folderTreeInk = { selectedChevron: "#FFFFFFCC" } as const;

export const folderTree = { indent: 16, inset: space.xs, chevronBox: 16, chevron: 9, folderIcon: 13, folderBox: 18 } as const;

export const folderPicker = { height: 180, row: 24 } as const;

export const bookmarkDialog = { belowField: space.xs, belowToolbar: space.xxs, rightInset: space.ml } as const;

export const bookmarksBar = {
  overflowWidth: 28,
  otherReserve: 150,
  dividerHeight: 14,
  dropLine: 2,
  dropLineRadius: capsule(2),
  dropLineInset: space.xs,
  dropRing: 1.5,
  dragStart: 4,
  springOpenMs: 550,
  ghostOpacity: 0.92,
  hoverIn: duration.fast,
  hoverOut: duration.base,
} as const;

export type BarSize = {
  height: number;
  item: number;
  itemMaxWidth: number;
  itemGap: number;
  padding: number;
  titleGap: number;
  radius: number;
  favicon: number;
  icon: number;
  iconBox: number;
  text: "small" | "body";
  menuWidth: number;
  menuRow: number;
};

export const barSizes: Record<"default" | "large", BarSize> = {
  default: { height: 30, item: 24, itemMaxWidth: 190, itemGap: 0, padding: space.m, titleGap: space.s, radius: radius.control, favicon: 14, icon: 12, iconBox: 16, text: "small", menuWidth: 260, menuRow: 28 },
  large: { height: 38, item: 30, itemMaxWidth: 220, itemGap: 2, padding: space.ml, titleGap: space.m, radius: radius.tile, favicon: 16, icon: 14, iconBox: 18, text: "body", menuWidth: 300, menuRow: 32 },
};

export const folderMenu = { offsetY: space.xs, cascadeOverlap: space.xs, hoverOpenMs: 160, margin: space.m, favicon: 16, chevronBox: 12 } as const;
