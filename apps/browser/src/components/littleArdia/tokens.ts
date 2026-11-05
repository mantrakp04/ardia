import { TOOLBAR_ROWS, type ToolbarRow } from "../../lib/toolbarRow";
import { radius, space } from "../ui/tokens";

export const SMALL_WINDOW_RADIUS = radius.sheet;

export const SMALL_WINDOW_FRAME = {
  dark: { outerRim: "rgba(0,0,0,0.95)", innerRim: "rgba(255,255,255,0.1)", shadowOpacity: 0.66, shadowRadius: 23, shadowOffset: [0, 21] as [number, number] },
  light: { outerRim: "rgba(0,0,0,0.15)", innerRim: "rgba(255,255,255,0)", shadowOpacity: 0.38, shadowRadius: 23, shadowOffset: [0, 21] as [number, number] },
};

export const TRAFFIC_LIGHT_PITCH = 23;
export const NAV_CENTER_PAST_ZOOM = 27;

export const SMALL_BAR_BUTTON = 28;

export const SMALL_BAR_ROW: ToolbarRow = { ...TOOLBAR_ROWS.regular, button: SMALL_BAR_BUTTON, buttonRadius: radius.toolbar };

export const SMALL_PROGRESS = { left: space.m, share: "96%" } as const;
