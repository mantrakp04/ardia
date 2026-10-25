export type OverviewTab = { id: string; title: string; url: string };

export function matchesQuery(text: string, query: string): boolean {
  const hay = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

export function filterOverviewTabs<T extends OverviewTab>(tabs: T[], query: string): T[] {
  if (!query.trim()) return tabs;
  return tabs.filter((t) => matchesQuery(`${t.title} ${t.url}`, query));
}

export function overviewColumns(width: number, min = 230, gap = 22): number {
  return width > 0 ? Math.max(1, Math.floor((width + gap) / (min + gap))) : 1;
}

export type OverviewTray = { after: string; keys: string[]; columns: number };

function chunk(keys: string[], columns: number): string[][] {
  const rows: string[][] = [];
  for (let i = 0; i < keys.length; i += Math.max(1, columns)) rows.push(keys.slice(i, i + Math.max(1, columns)));
  return rows;
}

export function overviewGrid(sections: string[][], columns: number, tray: OverviewTray | null): string[][] {
  const rows: string[][] = [];
  for (const keys of sections) {
    for (const row of chunk(keys, columns)) {
      rows.push(row);
      if (tray && row.includes(tray.after)) rows.push(...chunk(tray.keys, tray.columns));
    }
  }
  return rows;
}

export function moveInGrid(rows: string[][], selected: string | null, key: string): string | null {
  const r = rows.findIndex((row) => selected !== null && row.includes(selected));
  if (r < 0) return rows[0]?.[0] ?? null;
  const c = rows[r]!.indexOf(selected!);
  const at = (row: number, col: number) => rows[row]![Math.min(col, rows[row]!.length - 1)]!;
  switch (key) {
    case "ArrowRight":
      return c + 1 < rows[r]!.length ? rows[r]![c + 1]! : r + 1 < rows.length ? rows[r + 1]![0]! : selected;
    case "ArrowLeft":
      return c > 0 ? rows[r]![c - 1]! : r > 0 ? rows[r - 1]![rows[r - 1]!.length - 1]! : selected;
    case "ArrowDown":
      return r + 1 < rows.length ? at(r + 1, c) : selected;
    case "ArrowUp":
      return r > 0 ? at(r - 1, c) : selected;
    default:
      return selected;
  }
}
