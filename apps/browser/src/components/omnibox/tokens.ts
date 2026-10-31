import { curve } from "../ui/motion";
import { font, radius, space } from "../ui/tokens";

export const PANEL_TEXT_LEFT = 48;
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
  panelFieldLift: -3,
  panel: {
    height: 55,
    heroHeight: 60,
    iconLeft: PANEL_ICON_LEFT,
    heroIconLeft: 18,
    right: 18,
    heroGap: space.m,
    gap: PANEL_TEXT_LEFT - FIELD_TEXT_INSET - PANEL_ICON_LEFT - ICON_SLOT,
  },
  dropdown: { height: 44, left: 13, right: 9, gap: 9 },
  siteControls: { icon: 15, box: 26, radius: 13 },
  bottom: { left: 14, heroLeft: 13, right: 13, heroRight: 15, height: 52, heroHeight: 43, heroBelow: space.m, mic: 14 },
} as const;

export const ADD_CHIP = {
  height: 32,
  radius: 16,
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
  minWidth: 99,
  height: 32,
  padX: space.xl,
  radius: 16,
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

export const SUGGESTION = {
  listX: 8,
  dropdownListX: space.s,
  listBelow: space.xxs,
  dropdownListBelow: space.s,
  height: 36,
  gapY: 2,
  radius: 8,
  padX: 13,
  gap: 11,
  icon: 13,
  calcIcon: 14,
  iconBox: 16,
  remove: { glyph: 10, box: 22, radius: radius.m },
} as const;

export const SELECTED_SUGGESTION_ALPHA = { dark: 0.56, light: 0.3 } as const;

export const SUGGESTION_TEXT_SIZE = font.title.fontSize;

export const GROW = { duration: 130, easing: curve.outExpo } as const;
