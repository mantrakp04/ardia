import type { LiveFolder, LiveItem, LiveSection } from "./types";
import { showAllKey } from "./store";

export type FolderRow =
  | { kind: "item"; key: string; item: LiveItem }
  | { kind: "stack"; key: string; id: string; repo: string; items: LiveItem[] }
  | { kind: "header"; key: string; title: string }
  | { kind: "more"; key: string; section: string; count: number };

export const SECTION_TITLES: Record<LiveSection, string | null> = {
  authored: null,
  review: "Review Requests",
  team: "Team Review Requests",
  assigned: "Assigned to Me",
  created: "Created by Me",
  mentioned: "Mentioned",
};

const FOLDER_SECTIONS: Record<LiveFolder["kind"], LiveSection[] | null> = {
  pullRequests: ["authored", "review", "team"],
  issues: ["assigned", "created", "mentioned"],
  documents: null,
};

export const PAGE_SIZE = 8;

export type LiveTabPlace = "row" | "stray" | "hidden";

export const repoKey = (it: LiveItem) => {
  const repo = it.pr?.repo ?? it.issue?.repo;
  return repo ? `${it.source}:${repo}` : null;
};

export function liveTabPlace(itemId: string, shown: Set<string>, hidden: Set<string>): LiveTabPlace {
  return shown.has(itemId) ? "row" : hidden.has(itemId) ? "hidden" : "stray";
}

export function folderRows(folder: Pick<LiveFolder, "id" | "kind" | "groupStacks">, items: LiveItem[], showAll: Record<string, boolean>, page = PAGE_SIZE): FolderRow[] {
  const kinds = FOLDER_SECTIONS[folder.kind];
  const sections: [string, LiveItem[]][] = kinds ? kinds.map((s) => [s, items.filter((it) => (it.section ?? "authored") === s)]) : [["documents", items]];
  const rows: FolderRow[] = [];
  for (const [section, members] of sections) {
    if (!members.length) continue;
    const title = SECTION_TITLES[section as LiveSection];
    if (title) rows.push({ kind: "header", key: `h:${section}`, title });
    const entries: FolderRow[] = [];
    const stacked = new Set<string>();
    for (const it of members) {
      const stack = folder.groupStacks ? it.pr?.stack : undefined;
      if (!stack) {
        entries.push({ kind: "item", key: it.id, item: it });
        continue;
      }
      if (stacked.has(stack.id)) continue;
      stacked.add(stack.id);
      const inStack = members.filter((m) => m.pr?.stack?.id === stack.id).sort((a, b) => a.pr!.stack!.position - b.pr!.stack!.position);
      entries.push({ kind: "stack", key: stack.id, id: stack.id, repo: it.pr!.repo, items: inStack });
    }
    const all = showAll[showAllKey(folder.id, section)];
    rows.push(...(all ? entries : entries.slice(0, page)));
    if (!all && entries.length > page) rows.push({ kind: "more", key: `m:${section}`, section, count: entries.length - page });
  }
  return rows;
}
