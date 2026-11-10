import { PANEL } from "../ui/Popover";
import { POPOVER_WIDTH, space } from "../ui/tokens";

const CREDENTIAL_ROW = 42;
const FOOTER_ROW = 22;
const ROW_INSET = 7;
const FOOTER_TEXT_INSET = 15;

export const VAULT_MENU = {
  gap: space.xs,
  minWidth: POPOVER_WIDTH.s,
  maxWidth: 420,
  row: CREDENTIAL_ROW,
  compactRow: FOOTER_ROW,
  listPad: space.m,
  separatorGap: space.xs,
  footerBottom: space.m,
  rowInset: ROW_INSET,
  rowPadding: 10,
  footerPadding: FOOTER_TEXT_INSET - ROW_INSET,
  separatorInset: FOOTER_TEXT_INSET,
  rowRadius: 5,
  iconGap: space.l,
  touchID: 24,
  maxList: CREDENTIAL_ROW * 7,
  minList: CREDENTIAL_ROW * 2,
  searchHeight: 36,
  icon: { box: 26, glyph: 14, radius: 6 },
  badge: { box: 16, glyph: 9 },
  unlockBadge: { box: 20, glyph: 11 },
  spinner: 12,
  textGap: 1,
  badgeAlpha: 0.16,
  glassTint: 0.35,
  glassVeil: 0.55,
  detailAlpha: 0.72,
  glassSurface: { dark: "#3F3F3F", light: "#DBDBDB" },
} as const;

export const VAULT_TOUCH = {
  shakeMs: 320,
  shakeSteps: [0, 5, -3.6, 2.4, -1.4, 0.6, 0],
  grantMs: 160,
  grantFrom: 0.9,
  grantHoldMs: 260,
  tryAgainMs: 1600,
  crossfadeMs: 150,
  retryDisc: 22,
} as const;

export const VAULT_SAVE = { fieldGap: 6, passwordHeight: 24, usernameWidth: 260 } as const;

export const VAULT_CODE = { ring: 16, stroke: 2, tick: 1000, expiringMs: 5000 } as const;

export const VAULT_SETTINGS = { brandTile: 28, brandGlyph: 14, sheetTile: 36, sheetGlyph: 18, commandMinHeight: 32, spinner: 14, copiedMs: 1500 } as const;
