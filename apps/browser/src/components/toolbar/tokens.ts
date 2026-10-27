import { layout } from "../ui/theme";

export const GLYPH = 13;

export const TOOLBAR_LINE = 20.25;

export const BUTTON_LINE = TOOLBAR_LINE - 0.5;

export const CHEVRON_INSET = { x: 0.5, y: -0.5 } as const;

export const URL_FIELD = { top: 6.5, height: 27.5, right: 6.5, afterControls: 12 } as const;

export const URL_FIELD_RADIUS = layout.cardRadius - (URL_FIELD.top + URL_FIELD.right) / 2;

const FIELD_BUTTON_BOX = 23.5;
const FIELD_BUTTON_INSET = (URL_FIELD.height - FIELD_BUTTON_BOX) / 2;

export const FIELD_BUTTON = { box: FIELD_BUTTON_BOX, inset: FIELD_BUTTON_INSET, radius: URL_FIELD_RADIUS - FIELD_BUTTON_INSET } as const;

export const TOOLBAR_MOTION = { dim: 160, progress: 200, hide: 150, show: 200, settle: 0 } as const;
