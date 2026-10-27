import { curve } from "../ui/motion";
import { font, radius, space } from "../ui/tokens";

export const PANEL_TEXT_LEFT = 48;
export const PANEL_RADIUS = 17;
export const DROPDOWN_RADIUS = 12;
const PANEL_ICON_LEFT = 21;
const FIELD_TEXT_INSET = 2.5;
const ICON_SLOT = 18;

export const BAR_TYPE = {
  heroField: { fontSize: 17 },
  floatingField: font.title,
  panelField: font.body,
  goLabel: { fontSize: 15 },
  scope: { fontSize: 14 },
  heroScope: { fontSize: 15 },
} as const;

export const BAR = {
  iconSlot: ICON_SLOT,
  leadingIcon: 15,
  panelFieldLift: -2,
  panel: {
    height: 54,
    heroHeight: 60,
    iconLeft: PANEL_ICON_LEFT,
    heroIconLeft: 18,
    right: 18,
    heroGap: space.m,
    gap: PANEL_TEXT_LEFT - FIELD_TEXT_INSET - PANEL_ICON_LEFT - ICON_SLOT,
  },
  dropdown: { height: 44, left: 13, right: 9, gap: 9 },
  siteControls: { icon: 15, box: 26, radius: 13 },
  bottom: { left: 14, heroLeft: 13.5, right: 14, heroRight: 13.5, height: 53, heroHeight: 43, heroBelow: space.m, mic: 14 },
} as const;

export const ADD_CHIP = {
  height: 28,
  heroHeight: 32,
  border: 1,
  left: 9,
  right: 12,
  gap: 5,
  glyph: 10,
  glyphBox: 14,
  otherTabs: 12,
} as const;

export const GO_BUTTON = {
  before: space.m,
  minWidth: 92,
  heroMinWidth: 99,
  height: 29,
  heroHeight: 32,
  padX: space.xl,
  hoverOpacity: 0.9,
  gap: space.s,
  glyph: 11,
  glyphBox: 14,
  glyphAlpha: "99",
} as const;

export const SCOPE_CHIP = {
  height: 26,
  heroHeight: 28,
  radius: radius.l,
  left: 7,
  right: 9,
  gap: space.s,
  favicon: 14,
  maxWidth: 220,
} as const;

export type SuggestionVariant = "panel" | "hero" | "sidebar";

export type SuggestionRowMetrics = { inset: number; below: number; height: number; gapY: number; radius: number; left: number; right: number; gap: number };

const PANEL_ROW_INSET = 4;
const DROPDOWN_ROW_INSET = 4;

export const SUGGESTION_ROWS: Record<SuggestionVariant, SuggestionRowMetrics> = {
  panel: { inset: PANEL_ROW_INSET, below: 0, height: 36, gapY: 0, radius: PANEL_RADIUS - PANEL_ROW_INSET, left: 18, right: 18, gap: 9 },
  hero: { inset: 9, below: space.xxs, height: 35, gapY: 2.5, radius: 11, left: 10, right: 13, gap: 10.5 },
  sidebar: { inset: DROPDOWN_ROW_INSET, below: DROPDOWN_ROW_INSET, height: 35, gapY: 2.5, radius: DROPDOWN_RADIUS - DROPDOWN_ROW_INSET, left: 10, right: 15, gap: 12 },
};

export const SUGGESTION = {
  icon: 13,
  calcIcon: 14,
  iconBox: 16,
  remove: { glyph: 10, box: 22, radius: radius.m },
} as const;

export const SUGGESTION_TEXT_SIZE = font.title.fontSize;

export const GROW = { duration: 130, easing: curve.outExpo } as const;
