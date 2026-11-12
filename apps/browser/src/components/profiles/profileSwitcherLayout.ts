export function switcherScrollOffset(widths: number[], selected: number, room: number): number {
  if (selected < 0 || selected >= widths.length) return 0;
  const total = widths.reduce((sum, width) => sum + width, 0);
  const before = widths.slice(0, selected).reduce((sum, width) => sum + width, 0);
  return Math.max(0, Math.min(total - room, before - (room - widths[selected]!) / 2));
}
