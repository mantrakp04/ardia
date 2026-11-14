export function wholeRowsHeight(bottoms: readonly number[], room: number): number | null {
  if (room <= 0) return null;
  let fitting = 0;
  for (const bottom of bottoms) {
    if (bottom <= 0) return null;
    if (bottom > room) return fitting > 0 ? fitting : null;
    fitting = Math.max(fitting, bottom);
  }
  return null;
}
