import { fuzzyScore, hostOf } from "@ardia/core";

export type GroupPanelGroup = { tabIds: string[]; parentId?: string };
export type GroupPanelTab = { id: string; title: string; url: string; usedAt: number };

export function groupTabIds(groups: Record<string, GroupPanelGroup>, groupId: string): string[] {
  const children = new Map<string, string[]>();
  for (const [id, g] of Object.entries(groups)) if (g.parentId) children.get(g.parentId)?.push(id) ?? children.set(g.parentId, [id]);
  const seenGroups = new Set<string>();
  const seenTabs = new Set<string>();
  const out: string[] = [];
  const walk = (id: string) => {
    if (seenGroups.has(id) || !groups[id]) return;
    seenGroups.add(id);
    for (const tabId of groups[id]!.tabIds) {
      if (seenTabs.has(tabId)) continue;
      seenTabs.add(tabId);
      out.push(tabId);
    }
    for (const child of children.get(id) ?? []) walk(child);
  };
  walk(groupId);
  return out;
}

export const byRecentUse = <T extends GroupPanelTab>(rows: T[]): T[] => [...rows].sort((a, b) => b.usedAt - a.usedAt);

export function matchingRows<T extends GroupPanelTab>(query: string, rows: T[]): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows
    .map((row, order) => {
      const score = Math.max(fuzzyScore(q, row.title), fuzzyScore(q, hostOf(row.url)) * 0.9, fuzzyScore(q, row.url) * 0.6);
      const contains = row.title.toLowerCase().includes(q) || row.url.toLowerCase().includes(q);
      return { row, order, score: score > 0 ? score : contains ? 1 : 0 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((x) => x.row);
}
