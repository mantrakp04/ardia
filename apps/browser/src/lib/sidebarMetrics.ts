export const SIDEBAR_ROW = { height: 34, gap: 3 } as const;

export const SIDEBAR_GROUP = { indent: 16, border: 0.5, radius: 12, inset: 3 } as const;

export const SIDEBAR_TILE = { height: 41, gap: 6, minWidth: 50 } as const;

export const GROUP_MEMBERS_PAD_BOTTOM = SIDEBAR_GROUP.inset - SIDEBAR_GROUP.border;

export const SIDEBAR_SCALE = { min: 80, max: 120, step: 5, default: 100 } as const;

export const SIDEBAR_SCALES: readonly number[] = Array.from(
  { length: (SIDEBAR_SCALE.max - SIDEBAR_SCALE.min) / SIDEBAR_SCALE.step + 1 },
  (_, i) => SIDEBAR_SCALE.min + i * SIDEBAR_SCALE.step,
);

export const validSidebarScale = (v: unknown): v is number => typeof v === "number" && SIDEBAR_SCALES.includes(v);

export type TileGrid = { height: number; gap: number; minWidth: number; slot: number };

export type GroupMetrics = { indent: number; border: number; radius: number; innerRadius: number; inset: number; membersPadBottom: number };

export type SidebarMetrics = {
  percent: number;
  scale: number;
  px: (size: number) => number;
  rowHeight: number;
  rowGap: number;
  rowPitch: number;
  group: GroupMetrics;
  tile: TileGrid;
};

export const halfPoints = (size: number, scale: number) => Math.round(size * scale * 2) / 2;

function build(percent: number): SidebarMetrics {
  const scale = percent / 100;
  const px = (size: number) => halfPoints(size, scale);
  const rowHeight = px(SIDEBAR_ROW.height);
  const rowGap = px(SIDEBAR_ROW.gap);
  const inset = px(SIDEBAR_GROUP.inset);
  const groupRadius = px(SIDEBAR_GROUP.radius);
  const tileHeight = px(SIDEBAR_TILE.height);
  const tileGap = px(SIDEBAR_TILE.gap);
  return {
    percent,
    scale,
    px,
    rowHeight,
    rowGap,
    rowPitch: rowHeight + rowGap,
    group: {
      indent: px(SIDEBAR_GROUP.indent),
      border: SIDEBAR_GROUP.border,
      radius: groupRadius,
      innerRadius: groupRadius - SIDEBAR_GROUP.border,
      inset,
      membersPadBottom: inset - SIDEBAR_GROUP.border,
    },
    tile: { height: tileHeight, gap: tileGap, minWidth: px(SIDEBAR_TILE.minWidth), slot: tileHeight + tileGap },
  };
}

const built = new Map<number, SidebarMetrics>();

export function sidebarMetrics(percent: number): SidebarMetrics {
  const key = validSidebarScale(percent) ? percent : SIDEBAR_SCALE.default;
  let metrics = built.get(key);
  if (!metrics) built.set(key, (metrics = build(key)));
  return metrics;
}

export const BASE_SIDEBAR_METRICS = sidebarMetrics(SIDEBAR_SCALE.default);
