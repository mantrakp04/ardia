import { BASE_SIDEBAR_METRICS, type TileGrid } from "../../lib/sidebarMetrics";

export const BALANCED_MAX_COLUMNS = 4;
export const PIN_ZONE_HYSTERESIS = 6;

type Area = { x: number; y: number; w: number };

function gridColumns(count: number, innerWidth: number, balanced: boolean, tile: TileGrid) {
  const fit = Math.max(1, Math.floor((innerWidth + tile.gap) / (tile.minWidth + tile.gap)));
  if (!balanced) return Math.min(count || 1, fit);
  const rows = Math.ceil((count || 1) / Math.min(BALANCED_MAX_COLUMNS, fit));
  return Math.ceil((count || 1) / rows);
}

export function pinGrid(count: number, innerWidth: number, balanced = false, tile: TileGrid = BASE_SIDEBAR_METRICS.tile) {
  const columns = gridColumns(count, innerWidth, balanced, tile);
  const width = Math.floor(((innerWidth - tile.gap * (columns - 1)) / columns) * 2) / 2;
  return { columns, width };
}

export function pinGridHeight(count: number, innerWidth: number, tile: TileGrid, balanced = false): number {
  const rows = Math.max(1, Math.ceil(count / pinGrid(count, innerWidth, balanced, tile).columns));
  return rows * tile.height + (rows - 1) * tile.gap;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function pinSlot(grid: Area, count: number, tile: TileGrid, x: number, y: number, balanced = false): number {
  const { columns, width } = pinGrid(count, grid.w, balanced, tile);
  const rows = Math.max(1, Math.ceil(count / columns));
  const row = clamp(Math.floor((y - grid.y + tile.gap / 2) / tile.slot), 0, rows - 1);
  const column = clamp(Math.floor((x - grid.x + tile.gap / 2) / (width + tile.gap)), 0, columns - 1);
  return clamp(row * columns + column, 0, Math.max(0, count - 1));
}

export function overPins(y: number, listTop: number, wasOver: boolean, hysteresis = PIN_ZONE_HYSTERESIS): boolean {
  return y < listTop + (wasOver ? hysteresis : -hysteresis);
}
