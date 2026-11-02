import { duration } from "../ui/motion";
import type { Theme } from "../ui/theme";
import { capsule, font, space, withAlpha, type Space } from "../ui/tokens";

export type PagesColors = { rowSelected: string; dropTarget: string };

const ROW_SELECTED_ALPHA = { dark: 0x59 / 255, light: 0x33 / 255 };
const DROP_TARGET_ALPHA = 0x40 / 255;
const byTheme = new WeakMap<Theme, PagesColors>();

export function pagesColors(theme: Theme): PagesColors {
  let colors = byTheme.get(theme);
  if (!colors) {
    const rowSelected = withAlpha(theme.formAccent, theme.dark ? ROW_SELECTED_ALPHA.dark : ROW_SELECTED_ALPHA.light);
    byTheme.set(theme, (colors = { rowSelected, dropTarget: withAlpha(theme.formAccent, DROP_TARGET_ALPHA) }));
  }
  return colors;
}

export const pageType = { fileName: font.body, dayHeader: font.small } as const;

export const pageHeader = { sideWidth: 200, searchMaxWidth: 480 } as const;

export const pageToolbar: Record<"window" | "page" | "footer", { height: number; padX: Space; gap: Space }> = {
  window: { height: 52, padX: "l", gap: "xxs" },
  page: { height: 64, padX: "xxxl", gap: "xl" },
  footer: { height: 56, padX: "xxl", gap: "m" },
};

export const pageList = { endPad: 40 } as const;

export const downloadCard = { iconSize: 36, textGap: space.xs, progressHeight: 3, progressTop: 3, progressMin: 0.03 } as const;

export const historyRow = { height: 38, header: 44, headerInset: space.huge, timeWidth: 64, hostMaxWidth: 220, checkbox: 14, menuBox: 26, scrollSettleMs: duration.base } as const;

export const bookmarkList = { row: 36, treeWidth: 230, treeRow: 28, headerHeight: 40, dropLine: 2, dropLineRadius: capsule(2), folderIcon: 14, folderIconBox: 16, dragOpacity: 0.85 } as const;

export const undoToast = { visibleMs: 8000 } as const;

export const clearDataDialog = { rangeMinWidth: 150 } as const;
