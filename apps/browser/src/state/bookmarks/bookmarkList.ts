export type ListSelection = { selected: ReadonlySet<string>; anchor: string | null };

export const NO_SELECTION: ListSelection = { selected: new Set(), anchor: null };

export function clickSelection(ids: readonly string[], current: ListSelection, id: string, e: { metaKey?: boolean; shiftKey?: boolean }): ListSelection {
  if (e.shiftKey && current.anchor) {
    const from = ids.indexOf(current.anchor);
    const to = ids.indexOf(id);
    if (from >= 0 && to >= 0) return { selected: new Set(ids.slice(Math.min(from, to), Math.max(from, to) + 1)), anchor: current.anchor };
  }
  if (!e.metaKey) return { selected: new Set([id]), anchor: id };
  const selected = new Set(current.selected);
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  return { selected, anchor: id };
}

export const selectAll = (ids: readonly string[]): ListSelection => ({ selected: new Set(ids), anchor: ids[0] ?? null });

export const selectedInOrder = (ids: readonly string[], selection: ListSelection): string[] =>
  selection.selected.size ? ids.filter((id) => selection.selected.has(id)) : [];

export const ROW_WINDOW_STEP = 8;

export function rowWindow(count: number, rowHeight: number, scrollY: number, viewport: number): { first: number; end: number } {
  const overscan = Math.round(viewport / 2);
  const span = Math.ceil((viewport + 2 * overscan) / rowHeight) + ROW_WINDOW_STEP;
  const top = Math.floor(Math.max(0, scrollY - overscan) / rowHeight / ROW_WINDOW_STEP) * ROW_WINDOW_STEP;
  const first = Math.max(0, Math.min(top, count - span));
  return { first, end: Math.min(count, first + span) };
}
