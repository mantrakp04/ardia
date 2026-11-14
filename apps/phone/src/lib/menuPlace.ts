export type Rect = { x: number; y: number; width: number; height: number };

export const MENU_ROW = 46;
export const MENU_HEADING = 28;
export const MENU_DIVIDER = 9;
export const MENU_PADDING = 8;

export function menuHeight(items: readonly ("divider" | { heading: string } | object)[]): number {
  return items.reduce<number>((sum, item) => sum + (item === "divider" ? MENU_DIVIDER : "heading" in (item as object) ? MENU_HEADING : MENU_ROW), MENU_PADDING);
}

export function menuTop(anchor: Rect, host: Rect, height: number, margin: number): number {
  const rowTop = anchor.y - host.y;
  const rowBottom = rowTop + anchor.height;
  if (rowBottom + height + margin <= host.height) return rowBottom;
  if (rowTop - height - margin >= 0) return rowTop - height;
  return Math.max(margin, host.height - height - margin);
}
