import { duration, spring } from "../ui/motion";
import { concentric, radius, space } from "../ui/tokens";

export const TOP_STRIP_HEIGHT = 42;
export const MID = 21;
export const ITEM_HEIGHT = 32;
export const ITEM_TOP = MID - ITEM_HEIGHT / 2;
export const TAB_TOP = 3;
export const TAB_RADIUS = radius.chrome;
export const FLARE = 15;
export const RIM_HEIGHT = 27.5;
export const RIM_WIDTH = 0.5;
export const PEEK_PAD = space.m;
export const PEEK_HEIGHT = ITEM_HEIGHT + PEEK_PAD * 2;
export const PEEK_BORDER = 0.5;
export const PEEK_LEFT = 6;
export const PEEK_TOP = 4;
export const PEEK_HOVER_HEIGHT = 6;
export const PINNED_CELL = 34;
export const PINNED_SPACING = 2;
export const PINNED_FACE_INSET = 2;
export const PINNED_FACE_RADIUS = concentric(radius.chrome, PINNED_FACE_INSET);
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
export const GROUP_DIVIDER_LENGTH = 15;
export const FOLDER_HEIGHT = 24;
export const FOLDER_RADIUS = radius.tile;
export const FOLDER_PAD = { left: space.m, right: space.s } as const;
export const FOLDER_TITLE_GAP = space.m;
export const FOLDER_TITLE_MAX = 110;
export const DROP_RING_WIDTH = 1.5;
export const NEW_TAB_ICON = 13;
export const LIFT_SLOP = 12;
export const LIGHTS_GAP = 8;
export const ONTO_EDGE = MAX_CHIP / 4;
export const PROFILE_ROOM = 140;
export const DOWNLOADS_BOX = 34;
export const CONTROLS_GAP = 2;

export const LIFT_MS = duration.base;
export const DROP_GLOW_MS = duration.base;
export const INCOMING_GAP_MS = duration.fast;
export const FADE_IN_MS = duration.fast;
export const TUCK_FADE_MS = 120;

export const GROUP_SPRING = spring({ response: 0.3, damping: 0.82 });

const REORDER_OMEGA = 90;

export const SLIDE = { ...spring({ response: (2 * Math.PI) / REORDER_OMEGA, damping: 1 }), restDisplacementThreshold: 0.25, restSpeedThreshold: 2, useNativeDriver: false } as const;

export const GROUP_GLYPH = {
  width: 13,
  height: 11,
  sliver: 1.25,
  backHeight: 7,
  midHeight: 9,
  midGap: 0.6,
  faceGap: 0.5,
  face: { width: 9.4, height: 10.6 },
} as const;

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
