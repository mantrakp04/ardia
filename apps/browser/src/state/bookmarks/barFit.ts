export type BarFitInput = {
  ids: readonly string[];
  widthOf: (id: string) => number | undefined;
  room: number;
  chevron: number;
  gap: number;
  minWidth: number;
};

export type BarFit = { mounted: number; shown: number; starts: number[] };

export function barFit({ ids, widthOf, room, chevron, gap, minWidth }: BarFitInput): BarFit {
  const starts: number[] = [];
  const ends: number[] = [];
  let x = 0;
  for (const id of ids) {
    if (x >= room) break;
    const width = widthOf(id) ?? minWidth;
    starts.push(x);
    ends.push(x + width);
    x += width + gap;
  }
  const mounted = starts.length;
  if (mounted === ids.length && ends.every((end) => end <= room)) return { mounted, shown: mounted, starts };
  const limit = room - chevron;
  let shown = 0;
  while (shown < mounted && ends[shown]! <= limit) shown++;
  return { mounted, shown, starts };
}

const MENU_STEP_ROWS = 8;
const MENU_OVERSCAN_ROWS = 16;

export const menuScrollStep = (scrollTop: number, row: number) => Math.max(0, Math.floor(scrollTop / (row * MENU_STEP_ROWS)) * row * MENU_STEP_ROWS);

export function menuRows(count: number, scrollStep: number, viewport: number, row: number): { first: number; last: number } {
  const first = Math.max(0, Math.floor(scrollStep / row) - MENU_OVERSCAN_ROWS);
  const last = Math.min(count, Math.ceil((scrollStep + viewport) / row) + MENU_STEP_ROWS + MENU_OVERSCAN_ROWS);
  return { first, last };
}
