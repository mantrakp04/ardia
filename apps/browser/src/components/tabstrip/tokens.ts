import { duration } from "../ui/motion";
import { colorRoles, ink, type ShadowLevel } from "../ui/tokens";

export const TOP_STRIP_HEIGHT = 42;
export const TOP_CARD_INSET = 6;
export const MID = 21;
export const ITEM_HEIGHT = 32;
export const ITEM_TOP = MID - ITEM_HEIGHT / 2;
export const TAB_TOP = 3;
export const TAB_RADIUS = 10;
export const FLARE = 15;
export const RIM_HEIGHT = 27.5;
export const RIM_WIDTH = 0.5;
export const PEEK_PAD = 7;
export const PEEK_HEIGHT = ITEM_HEIGHT + PEEK_PAD * 2;
export const PEEK_BORDER = 0.5;
export const PEEK_LEFT = 6;
export const PEEK_TOP = 4;
export const PEEK_HOVER_HEIGHT = 6;
export const PINNED_CELL = 34;
export const PINNED_SPACING = 2;
export const PINNED_FACE_INSET = 2;
export const PINNED_FACE_RADIUS = 8;
export const PINNED_RING_STROKE = 2;
export const DOCK_GAP = 4.5;
export const MIN_CHIP = 96;
export const MAX_CHIP = 173;
export const GAP = 4;
export const CHIP_PAD = { left: 9.5, right: 6 } as const;
export const CHIP_LABEL_GAP = 5;
export const CHIP_HAIRLINE = 0.5;
export const GROUP_CHIP_PAD = { left: 8.5, right: 7 } as const;
export const GROUP_TITLE_GAP = 12.5;
export const GROUP_TITLE_MAX = 120;
export const FOLDER_HEIGHT = 24;
export const FOLDER_RADIUS = 7;
export const FOLDER_PAD = { left: 7, right: 6 } as const;
export const FOLDER_TITLE_GAP = 7;
export const FOLDER_TITLE_MAX = 110;
export const DROP_RING_WIDTH = 1.5;
export const NEW_TAB_ICON = 13;
export const LIFT_SLOP = 12;
export const LIGHTS_GAP = 8;
export const ONTO_EDGE = MAX_CHIP / 4;
export const PROFILE_ROOM = 140;
export const DOWNLOADS_BOX = 34;
export const CONTROLS_GAP = 2;

export const LIFT_MS = 150;
export const DROP_GLOW_MS = 140;
export const INCOMING_GAP_MS = 120;
export const FADE_IN_MS = duration.instant;

export const STRIP_COLORS = {
  dark: {
    floatingTabBorder: "rgba(255,255,255,0.15)",
    selectedRim: ["#FFFFFF3B", "#FFFFFF00"],
    groupDivider: "rgba(255,255,255,0.16)",
  },
  light: {
    floatingTabBorder: "rgba(0,0,0,0.08)",
    selectedRim: ["#FFFFFFFA", "#FFFFFF00"],
    groupDivider: "rgba(0,0,0,0.12)",
  },
};

export const PEEK_SHADOW: ShadowLevel = {
  color: ink.black,
  opacity: { dark: colorRoles.dark.panelShadowOpacity, light: colorRoles.light.panelShadowOpacity },
  radius: 20,
  offset: [0, 6],
};
