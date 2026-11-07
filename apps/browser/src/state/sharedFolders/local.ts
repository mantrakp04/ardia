import type { BrowserState } from "../browser/store";
import type { Tab, TabGroup } from "../browser/types";
import { pinKeyOf } from "../browser/model";
import { displayHostOf } from "../../lib/url";
import { isShareableUrl } from "./remote";
import type { BaseEntry, LocalEntry } from "./tree";

export type LocalFolder = {
  entries: LocalEntry[];
  tabOf: Map<string, string>;
  groupOf: Map<string, string>;
  nameOf: Map<string, string>;
  urlOf: Map<string, string>;
  others: Map<string, string[]>;
};

export const linkUrl = (t: Tab) => t.pinnedUrl || t.url;

export const linkName = (t: Tab, known: string | undefined) => t.customTitle?.trim() || known || t.title.trim() || displayHostOf(linkUrl(t)) || "Link";

export const groupName = (g: TabGroup) => g.name.trim() || "Folder";

export function knownNames(base: BaseEntry[], into = new Map<string, string>()): Map<string, string> {
  for (const b of base) {
    into.set(b.key, b.name);
    if (b.kind === "dir") knownNames(b.children, into);
  }
  return into;
}

export function localFolder(s: Pick<BrowserState, "groups" | "tabs" | "windows">, groupId: string, names: Map<string, string>): LocalFolder | null {
  const root = s.groups[groupId];
  const w = root && s.windows[root.windowId];
  if (!root || !w) return null;
  const position = new Map(w.tabIds.map((id, i) => [id, i]));
  const children = new Map<string, TabGroup[]>();
  for (const g of Object.values(s.groups)) if (g.parentId && g.windowId === root.windowId) children.set(g.parentId, [...(children.get(g.parentId) ?? []), g]);
  const folder: LocalFolder = { entries: [], tabOf: new Map(), groupOf: new Map(), nameOf: new Map(), urlOf: new Map(), others: new Map() };
  const walk = (g: TabGroup, seen: Set<string>): LocalEntry[] => {
    const kidOf = new Map<string, TabGroup>();
    for (const k of children.get(g.id) ?? []) if (!seen.has(k.id)) for (const id of k.tabIds) kidOf.set(id, k);
    const out: LocalEntry[] = [];
    const done = new Set<string>();
    const extra: string[] = [];
    for (const id of [...g.tabIds].sort((a, z) => (position.get(a) ?? 0) - (position.get(z) ?? 0))) {
      const kid = kidOf.get(id);
      if (kid) {
        if (done.has(kid.id)) continue;
        done.add(kid.id);
        const key = pinKeyOf(kid);
        folder.groupOf.set(key, kid.id);
        folder.nameOf.set(key, groupName(kid));
        out.push({ kind: "dir", key, name: groupName(kid), children: walk(kid, new Set([...seen, kid.id])) });
        continue;
      }
      const t = s.tabs[id];
      if (!t) continue;
      const url = linkUrl(t);
      if (!isShareableUrl(url)) {
        extra.push(id);
        continue;
      }
      const key = pinKeyOf(t);
      const name = linkName(t, names.get(key));
      folder.tabOf.set(key, id);
      folder.nameOf.set(key, name);
      folder.urlOf.set(key, url);
      out.push({ kind: "link", key, name, url });
    }
    folder.others.set(g.id, extra);
    return out;
  };
  folder.entries = walk(root, new Set([root.id]));
  return folder;
}

export const signatureOf = (folder: LocalFolder | null) => (folder ? JSON.stringify(folder.entries) : "");
