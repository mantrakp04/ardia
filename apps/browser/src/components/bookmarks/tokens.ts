export const folderTreeInk = { selectedChevron: "#FFFFFFCC" } as const;

export const folderTree = { row: 26, indent: 16, inset: 4, chevronBox: 16, chevron: 9, folderIcon: 13, folderBox: 18 } as const;

export const folderPicker = { addedHeight: 176, editHeight: 180, row: 24 } as const;

export const bookmarkDialog = { width: 320, belowField: 4, belowToolbar: 2, rightInset: 10, buttonsTop: 14 } as const;

export const editBookmarkDialog = { width: 420, buttonsTop: 18 } as const;

export const fieldLabel = { gapBelow: 5 } as const;

export const bookmarksBar = {
  overflowWidth: 28,
  otherReserve: 150,
  dividerHeight: 14,
  dropLine: 2,
  dropLineRadius: 1,
  dropLineInset: 3,
  dropRing: 1.5,
  dragStart: 4,
  springOpenMs: 550,
  ghostOpacity: 0.92,
  hoverIn: 90,
  hoverOut: 160,
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
  default: { height: 30, item: 24, itemMaxWidth: 190, itemGap: 0, padding: 7, titleGap: 6, radius: 6, favicon: 14, icon: 12, iconBox: 16, text: "small", menuWidth: 260, menuRow: 28 },
  large: { height: 38, item: 30, itemMaxWidth: 220, itemGap: 2, padding: 10, titleGap: 7, radius: 8, favicon: 16, icon: 14, iconBox: 18, text: "body", menuWidth: 300, menuRow: 32 },
};

export const folderMenu = { offsetY: 3, cascadeOverlap: 4, hoverOpenMs: 160, margin: 8, favicon: 16, chevronBox: 12 } as const;
