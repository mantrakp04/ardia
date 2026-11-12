import { createContext, useContext } from "react";
import { SIDEBAR_SCALE, sidebarMetrics, type SidebarMetrics } from "../../lib/sidebarMetrics";
import { useSettings } from "../../state/browser/hooks";
import { font, iconButton, lineHeight, radius, space } from "../ui/tokens";
import { TAB_ROW, TILE_STATUS } from "./tokens";

type TabRowMetrics = { -readonly [K in keyof typeof TAB_ROW]: number };

export type SidebarScale = SidebarMetrics & {
  tabRow: TabRowMetrics;
  font: { body: number; small: number; caption: number; tiny: number; compact: number };
  lineHeight: { caption: number };
  space: { xxs: number; xs: number; s: number; m: number; l: number };
  radius: { tile: number; chrome: number };
  icon: number;
  compactIcon: number;
  glyph: { s: number; m: number };
  rowButton: { box: number; glyph: number };
  tileStatus: { pip: number; speaker: number; box: { width: number; height: number }; inset: { x: number; y: number } };
  titleFrame: { flex: 1; height: number; marginLeft: number };
  compactTitleFrame: { flex: 1; height: number; marginLeft: number };
};

const ROW_ICON = 16;
const COMPACT_ROW_ICON = 14;
const ROW_GLYPH = { s: 11, m: 12 } as const;

function build(m: SidebarMetrics): SidebarScale {
  const { px } = m;
  const tabRow = Object.fromEntries(Object.entries(TAB_ROW).map(([k, v]) => [k, px(v)])) as TabRowMetrics;
  return {
    ...m,
    tabRow,
    font: { body: px(font.body.fontSize), small: px(font.small.fontSize), caption: px(font.caption.fontSize), tiny: px(font.tiny.fontSize), compact: px(font.small.fontSize) },
    lineHeight: { caption: px(lineHeight.caption) },
    space: { xxs: px(space.xxs), xs: px(space.xs), s: px(space.s), m: px(space.m), l: px(space.l) },
    radius: { tile: px(radius.tile), chrome: px(radius.chrome) },
    icon: px(ROW_ICON),
    compactIcon: px(COMPACT_ROW_ICON),
    glyph: { s: px(ROW_GLYPH.s), m: px(ROW_GLYPH.m) },
    rowButton: { box: px(iconButton.s.box), glyph: px(iconButton.s.glyph) },
    tileStatus: {
      pip: px(TILE_STATUS.pip),
      speaker: px(TILE_STATUS.speaker),
      box: { width: px(TILE_STATUS.box.width), height: px(TILE_STATUS.box.height) },
      inset: { x: px(TILE_STATUS.inset.x), y: px(TILE_STATUS.inset.y) },
    },
    titleFrame: { flex: 1, height: tabRow.titleHeight, marginLeft: tabRow.titleGap },
    compactTitleFrame: { flex: 1, height: tabRow.compactTitleHeight, marginLeft: tabRow.titleGap },
  };
}

const built = new Map<number, SidebarScale>();

export function sidebarScale(percent: number): SidebarScale {
  const metrics = sidebarMetrics(percent);
  let scaled = built.get(metrics.percent);
  if (!scaled) built.set(metrics.percent, (scaled = build(metrics)));
  return scaled;
}

export const SidebarScaleContext = createContext<SidebarScale>(sidebarScale(SIDEBAR_SCALE.default));

export const useSidebarScale = (): SidebarScale => useContext(SidebarScaleContext);

export const useChosenSidebarScale = (): SidebarScale => sidebarScale(useSettings((s) => s.sidebarScale));
