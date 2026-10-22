export const TILE_GAP = 6;
export const MIN_TILE = 50;
export const MAX_COLUMNS = 4;
export const PIN_ZONE_HYSTERESIS = 6;

type Area = { x: number; y: number; w: number };

export function pinGrid(count: number, innerWidth: number) {
  const fit = Math.max(1, Math.min(MAX_COLUMNS, Math.floor((innerWidth + TILE_GAP) / (MIN_TILE + TILE_GAP))));
  const rows = Math.ceil((count || 1) / fit);
  const columns = Math.ceil((count || 1) / rows);
  const width = Math.floor(((innerWidth - TILE_GAP * (columns - 1)) / columns) * 2) / 2;
  return { columns, width };
}

export function pinGridHeight(count: number, innerWidth: number, tileHeight: number): number {
  const rows = Math.max(1, Math.ceil(count / pinGrid(count, innerWidth).columns));
  return rows * tileHeight + (rows - 1) * TILE_GAP;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function pinSlot(grid: Area, count: number, tileHeight: number, x: number, y: number): number {
  const { columns, width } = pinGrid(count, grid.w);
  const rows = Math.max(1, Math.ceil(count / columns));
  const row = clamp(Math.floor((y - grid.y + TILE_GAP / 2) / (tileHeight + TILE_GAP)), 0, rows - 1);
  const column = clamp(Math.floor((x - grid.x + TILE_GAP / 2) / (width + TILE_GAP)), 0, columns - 1);
  return clamp(row * columns + column, 0, Math.max(0, count - 1));
}

export function overPins(y: number, listTop: number, wasOver: boolean, hysteresis = PIN_ZONE_HYSTERESIS): boolean {
  return y < listTop + (wasOver ? hysteresis : -hysteresis);
}
