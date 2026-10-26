import { StyleSheet } from "react-native";
import { curve } from "../ui/motion";
import { PANEL } from "../ui/Popover";
import { useTheme, type Theme } from "../ui/theme";
import { space } from "../ui/tokens";

const DARK = {
  progressTrack: "#717782",
  bubbleTint: "rgba(38,38,38,0.3)",
};

const LIGHT: typeof DARK = {
  progressTrack: "#CED7E7",
  bubbleTint: "rgba(255,255,255,0.3)",
};

export type DownloadsColors = typeof DARK;

export function useDownloadsColors(): DownloadsColors {
  return useTheme().dark ? DARK : LIGHT;
}

export function downloadsRowFill(theme: Theme, hovered: boolean, pressed: boolean) {
  if (!hovered && !pressed) return undefined;
  return pressed ? theme.popoverRowPressed : theme.rowHover;
}

const HEADER = 24;
const INK_INSET = PANEL.inset + 1;
const HEADER_CAP_TOP = 7.5;
const FOOTER_TEXT_DROP = 12;
const ROW_BUTTON = 22;
const PAD_TOP = INK_INSET - HEADER_CAP_TOP;
const PAD_BOTTOM = INK_INSET - FOOTER_TEXT_DROP;

export const DOWNLOADS_LIST = {
  header: HEADER,
  headerTracking: 0.4,
  clearHeight: 22,
  row: 40,
  fileIcon: 24,
  rowButton: ROW_BUTTON,
  rowButtonRadius: 6,
  rowButtonBearing: (ROW_BUTTON - PANEL.iconSize) / 2,
  visibleRows: 8,
  textButtonPad: space.sm,
  chevronBearing: 3,
  chevronSize: 9,
  chevronBox: 12,
  padTop: PAD_TOP,
  padBottom: PAD_BOTTOM,
  chrome: PAD_TOP + HEADER + StyleSheet.hairlineWidth + PANEL.separatorGap * 2 + PANEL.rowHeight + PAD_BOTTOM,
  progressHeight: 3,
  progressRadius: 1.5,
  progressAbove: 3,
  progressBelow: 2,
  progressMin: 0.03,
  missingOpacity: 0.45,
  placeDeadlineMs: 120,
} as const;

export const DOWNLOADS_BUTTON = { icon: 16, radius: 10 } as const;

export const FILE_ICON_GLYPH_SHARE = 0.62;

export const MAGNET = {
  flight: { duration: 700, easing: curve.flight },
  icon: 44,
  arc: 90,
  startShare: 0.45,
  topStripTarget: { right: 25, y: 21 },
  sidebarTarget: { right: 24, y: 27 },
  closedTarget: { x: 24, y: 24 },
} as const;
