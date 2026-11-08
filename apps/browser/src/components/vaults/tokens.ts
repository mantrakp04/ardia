import { PANEL } from "../ui/Popover";
import { POPOVER_WIDTH, space } from "../ui/tokens";

const TWO_LINE_ROW = 40;

export const VAULT_MENU = {
  gap: space.xs,
  minWidth: POPOVER_WIDTH.s,
  maxWidth: POPOVER_WIDTH.l,
  row: TWO_LINE_ROW,
  compactRow: PANEL.rowHeight,
  listPad: PANEL.inset - (TWO_LINE_ROW - PANEL.iconSlot) / 2,
  footerPad: PANEL.listPadding,
  maxList: TWO_LINE_ROW * 7,
  minList: TWO_LINE_ROW * 2,
  searchHeight: 36,
  badge: { box: 16, glyph: 9 },
  unlockBadge: { box: 20, glyph: 11 },
  spinner: 12,
  textGap: 1,
  badgeAlpha: 0.16,
} as const;

export const VAULT_CODE = { ring: 16, stroke: 2, tick: 1000, expiringMs: 5000 } as const;

export const VAULT_SETTINGS = { brandTile: 28, brandGlyph: 14, sheetTile: 36, sheetGlyph: 18, commandMinHeight: 32, spinner: 14, copiedMs: 1500 } as const;
