import { colorRoles, ink } from "../ui/tokens";

const dark = {
  rowSelected: `${colorRoles.dark.formAccent}59`,
  dropTarget: `${colorRoles.dark.formAccent}40`,
  toastFill: "#3A3A3C",
};

export type PagesColors = typeof dark;

const light: PagesColors = {
  rowSelected: `${colorRoles.light.formAccent}33`,
  dropTarget: `${colorRoles.light.formAccent}40`,
  toastFill: "#2C2C2E",
};

export const pagesColors = { dark, light } as const;

export const toastInk = { text: ink.white, action: "#64A8FF" } as const;

export const pageType = { title: 22, fileName: 13.5, dayHeader: 12.5 } as const;

export const pageHeader = { height: 64, sideWidth: 200, searchMaxWidth: 480 } as const;

export const emptyState = { liftBottom: 80, subtitleMaxWidth: 360 } as const;

export const pageList = { endPad: 40 } as const;

export const downloadCard = { iconSize: 36, textGap: 3, progressHeight: 3, progressRadius: 1.5, progressTop: 3, progressMin: 0.03, menuBox: 26 } as const;

export const historyRow = { height: 38, header: 44, headerInset: 30, timeWidth: 64, hostMaxWidth: 220, checkbox: 14, menuBox: 26, scrollSettleMs: 150 } as const;

export const bookmarkList = { row: 36, treeWidth: 230, treeRow: 28, headerHeight: 40, menuBox: 24, dropLine: 2, dropLineRadius: 1, folderIcon: 14, folderIconBox: 16, dragOpacity: 0.85, emptyIcon: 26, emptyIconBox: 36 } as const;

export const undoToast = { bottom: 24, height: 38, padLeft: 16, padRight: 8, actionHeight: 26, visibleMs: 8000 } as const;

export const clearDataDialog = { width: 440, rangeMinWidth: 150, buttonsTop: 22, noteIndent: 21 } as const;

export const emptyIcon = { size: 30, box: 40 } as const;

export const EMPTY_ICON = { width: emptyIcon.box, height: emptyIcon.box } as const;
