export type OverviewTab = { id: string; title: string; url: string };

export function filterOverviewTabs<T extends OverviewTab>(tabs: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return tabs;
  return tabs.filter((t) => {
    const hay = `${t.title} ${t.url}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function overviewColumns(width: number, min = 230, gap = 22): number {
  return width > 0 ? Math.max(1, Math.floor((width + gap) / (min + gap))) : 1;
}

export function moveSelection(index: number, count: number, columns: number, key: string): number {
  if (!count) return -1;
  const at = Math.min(Math.max(index, 0), count - 1);
  switch (key) {
    case "ArrowRight":
      return Math.min(count - 1, at + 1);
    case "ArrowLeft":
      return Math.max(0, at - 1);
    case "ArrowDown":
      return at + columns < count ? at + columns : at;
    case "ArrowUp":
      return at - columns >= 0 ? at - columns : at;
    default:
      return at;
  }
}
