import type { SpaceSuggestion } from "@ardia/import";
import { folder, ImportFailure, link, type BookmarkNode, type BookmarkRole, type ImportedTab } from "./model";

type Json = Record<string, unknown>;

export type ArcSidebar = { spaces: SpaceSuggestion[]; favorites: Record<string, ImportedTab[]> };

const MAX_DEPTH = 64;
const SPLIT_ROLE: BookmarkRole = "split";
const APPLE_EPOCH_SECONDS = 978_307_200;

export const THEME_LIMITS = { bytes: 64 * 1024, depth: 12, array: 4, keys: 32, string: 256, nodes: 2_048 };

const record = (value: unknown): Json | undefined => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : undefined);
const objects = (value: unknown): Json[] => (Array.isArray(value) ? value.map(record).filter((v): v is Json => v !== undefined) : []);
const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const nonEmpty = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);

function pairs(value: unknown): [unknown, unknown][] {
  const list = Array.isArray(value) ? value : [];
  const out: [unknown, unknown][] = [];
  for (let i = 0; i + 1 < list.length; i += 2) out.push([list[i], list[i + 1]]);
  return out;
}

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

function utf8Prefix(s: string, bytes: number): string {
  const encoded = new TextEncoder().encode(s);
  if (encoded.length <= bytes) return s;
  let end = bytes;
  while (end > 0 && (encoded[end]! & 0xc0) === 0x80) end--;
  return new TextDecoder().decode(encoded.subarray(0, end));
}

export function boundedTheme(value: unknown): unknown {
  const budget = { nodes: THEME_LIMITS.nodes, bytes: THEME_LIMITS.bytes };
  const spend = (nodes: number, bytes: number) => {
    budget.nodes -= nodes;
    budget.bytes -= bytes;
    return budget.nodes >= 0 && budget.bytes >= 0;
  };
  const over = () => budget.nodes < 0 || budget.bytes < 0;
  const walk = (any: unknown, depth: number): unknown => {
    if (any === undefined || any === null || depth >= THEME_LIMITS.depth || !spend(1, 8)) return undefined;
    if (Array.isArray(any)) {
      const out: unknown[] = [];
      for (const item of any.slice(0, THEME_LIMITS.array)) {
        const v = walk(item, depth + 1);
        if (v !== undefined) out.push(v);
        if (over()) return undefined;
      }
      return out;
    }
    if (typeof any === "object") {
      const d = any as Json;
      const keys = Object.keys(d);
      if (keys.length > THEME_LIMITS.keys) return undefined;
      const out: Json = {};
      for (const key of keys.sort()) {
        if (utf8Length(key) > THEME_LIMITS.string || !spend(0, utf8Length(key))) return undefined;
        const v = walk(d[key], depth + 1);
        if (v !== undefined) out[key] = v;
        if (over()) return undefined;
      }
      return out;
    }
    if (typeof any === "string") {
      const cut = utf8Prefix(any, THEME_LIMITS.string);
      return spend(0, utf8Length(cut)) ? cut : undefined;
    }
    if (typeof any === "number" || typeof any === "boolean") return any;
    return undefined;
  };
  const out = walk(value, 0);
  return over() ? undefined : out;
}

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value && typeof value === "object") {
    const d = value as Json;
    return `{${Object.keys(d)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${sortedJson(d[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function themeJson(theme: unknown): string | undefined {
  if (theme === undefined || theme === null || typeof theme !== "object") return undefined;
  const out = sortedJson(theme);
  return utf8Length(out) <= THEME_LIMITS.bytes ? out : undefined;
}

const hexByte = (v: number) =>
  Math.round(Math.min(Math.max(v, 0), 1) * 255)
    .toString(16)
    .toUpperCase()
    .padStart(2, "0");

export const rgbHex = (r: number, g: number, b: number) => `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`;

function color(value: unknown): string | undefined {
  const c = record(value);
  if (!c || typeof c.red !== "number" || typeof c.green !== "number" || typeof c.blue !== "number") return undefined;
  return rgbHex(c.red, c.green, c.blue);
}

function firstColor(value: unknown, depth: number): string | undefined {
  if (depth >= 12) return undefined;
  const c = color(value);
  if (c) return c;
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = firstColor(v, depth + 1);
      if (found) return found;
    }
  } else if (record(value)) {
    const d = value as Json;
    for (const key of Object.keys(d).sort()) {
      const found = firstColor(d[key], depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

export function midTone(theme: unknown): string | undefined {
  return color(record(record(theme)?.primaryColorPalette)?.midTone) ?? firstColor(theme, 0);
}

export function gradient(theme: unknown): string[] | undefined {
  const find = (value: unknown, depth: number): unknown[] | undefined => {
    if (depth >= 12) return undefined;
    if (Array.isArray(value)) {
      for (const v of value) {
        const found = find(v, depth + 1);
        if (found) return found;
      }
      return undefined;
    }
    const d = record(value);
    if (!d) return undefined;
    if (Array.isArray(d.baseColors)) return d.baseColors;
    for (const key of Object.keys(d).sort()) {
      const found = find(d[key], depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  const colors = (find(theme, 0) ?? []).map((entry) => color(entry) ?? firstColor(entry, 0)).filter((c): c is string => c !== undefined);
  return colors.length ? colors : undefined;
}

function emoji(icon: Json | undefined): string | undefined {
  const v2 = nonEmpty(icon?.emoji_v2);
  if (v2) return v2;
  const plain = icon?.emoji;
  if (typeof plain === "string" && plain) return plain;
  if (typeof plain === "number" && Number.isInteger(plain) && plain >= 0 && plain <= 0x10ffff && !(plain >= 0xd800 && plain <= 0xdfff)) return String.fromCodePoint(plain);
  return undefined;
}

export function profileDirectory(value: unknown): string | undefined {
  const d = record(value);
  if (!d) return undefined;
  if (d.default !== undefined) return "Default";
  return nonEmpty(record(record(d.custom)?._0)?.directoryBasename);
}

function liveFolderRole(list: unknown): BookmarkRole | undefined {
  const live = record(list)?.automaticLiveFolderData;
  if (live === undefined) return undefined;
  const lower = JSON.stringify([live]).toLowerCase();
  if (lower.includes("bitbucket")) return "liveBitbucketPullRequests";
  return lower.includes("github") ? "liveGitHubPullRequests" : undefined;
}

function mainContainer(containers: unknown[]): Json | undefined {
  const boxes = containers.map((c) => record(c) ?? {});
  const holdsSidebar = (i: number) => boxes[i]!.spaces !== undefined || boxes[i]!.items !== undefined;
  const after = (i: number, marker: string) => i > 0 && boxes[i - 1]![marker] !== undefined;
  let index = boxes.findIndex((_, i) => holdsSidebar(i) && after(i, "global"));
  if (index < 0) index = boxes.findIndex((_, i) => holdsSidebar(i) && !after(i, "littleBrowser"));
  return index < 0 ? undefined : boxes[index];
}

function containerIDs(space: Json): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (key: string, id: string) => {
    const list = out.get(key) ?? [];
    if (!list.includes(id)) out.set(key, [...list, id]);
  };
  for (const [label, value] of pairs(space.newContainerIDs)) {
    const id = text(value);
    const key = Object.keys(record(label) ?? {})[0];
    if (id !== undefined && key !== undefined) add(key, id);
  }
  for (const [label, value] of pairs(space.containerIDs)) {
    if (typeof label === "string" && typeof value === "string") add(label, value);
  }
  return out;
}

class Items {
  private byId = new Map<string, Json>();
  private adopted = new Map<string, string[]>();

  constructor(list: Json[]) {
    const order: string[] = [];
    for (const item of list) {
      const id = text(item.id);
      if (id === undefined) continue;
      if (!this.byId.has(id)) order.push(id);
      this.byId.set(id, item);
    }
    for (const id of order) {
      const parent = text(this.byId.get(id)?.parentID);
      if (parent === undefined || parent === id || !this.byId.has(parent)) continue;
      this.adopted.set(parent, [...(this.adopted.get(parent) ?? []), id]);
    }
  }

  get(id: string) {
    return this.byId.get(id);
  }

  listed(id: string): string[] {
    const ids = this.byId.get(id)?.childrenIds;
    if (!Array.isArray(ids) || !ids.every((c) => typeof c === "string")) return [];
    return (ids as string[]).filter((c) => this.byId.has(c));
  }

  children(id: string): string[] {
    const listed = this.listed(id);
    const known = new Set(listed);
    return [...listed, ...(this.adopted.get(id) ?? []).filter((c) => !known.has(c))];
  }
}

const customTitle = (item: Json) => nonEmpty(item.title);
const dataOf = (item: Json) => record(item.data) ?? {};
const isSplit = (item: Json) => dataOf(item).splitView !== undefined;

function tabOf(item: Json, pinned: boolean): ImportedTab | undefined {
  const tab = record(dataOf(item).tab);
  const url = nonEmpty(tab?.savedURL);
  if (!tab || !url) return undefined;
  const custom = customTitle(item);
  const last = typeof tab.timeLastActiveAt === "number" ? (tab.timeLastActiveAt + APPLE_EPOCH_SECONDS) * 1000 : undefined;
  return {
    url,
    title: text(tab.savedTitle) ?? "",
    pinned,
    windowIndex: 0,
    active: false,
    ...(custom !== undefined ? { customTitle: custom } : {}),
    ...(last !== undefined ? { lastActive: last } : {}),
  };
}

function tree(containerId: string, items: Items, seen: Set<string>, depth = 0): BookmarkNode[] {
  if (depth >= MAX_DEPTH || !items.get(containerId) || seen.has(containerId)) return [];
  seen.add(containerId);
  const out: BookmarkNode[] = [];
  for (const id of items.children(containerId)) {
    const item = items.get(id);
    if (!item) continue;
    const data = dataOf(item);
    const t = tabOf(item, true);
    if (t) {
      if (seen.has(id)) continue;
      seen.add(id);
      const node = link(t.customTitle ?? t.title, t.url);
      out.push(t.customTitle !== undefined ? { ...node, pageTitle: t.title } : node);
      continue;
    }
    const role = liveFolderRole(data.list);
    if (role) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(folder(customTitle(item) ?? "Pull Requests", [], { role }));
    } else if (data.list !== undefined) {
      out.push(folder(customTitle(item) ?? "Folder", tree(id, items, seen, depth + 1)));
    } else if (isSplit(item)) {
      const panes = tree(id, items, seen, depth + 1);
      if (panes.length >= 2 && panes.every((p) => p.type === "url")) out.push(folder(customTitle(item) ?? "", panes, { role: SPLIT_ROLE }));
      else out.push(...panes);
    }
  }
  return out;
}

function flatTabs(containerId: string, items: Items, seen: Set<string>, pinned: boolean, splits = true, depth = 0): ImportedTab[] {
  if (depth >= MAX_DEPTH || !items.get(containerId) || seen.has(containerId)) return [];
  seen.add(containerId);
  const out: ImportedTab[] = [];
  for (const id of items.listed(containerId)) {
    const item = items.get(id);
    if (!item) continue;
    const t = tabOf(item, pinned);
    if (t) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(t);
      }
      continue;
    }
    let inner = flatTabs(id, items, seen, pinned, splits, depth + 1);
    if (splits && isSplit(item) && inner.length >= 2 && inner.every((x) => x.splitId === undefined)) inner = inner.map((x) => ({ ...x, splitId: id }));
    out.push(...inner);
  }
  return out;
}

export function parseArcSidebar(raw: string): ArcSidebar {
  let top: unknown;
  try {
    top = JSON.parse(raw);
  } catch {
    top = undefined;
  }
  const containers = record(record(top)?.sidebar)?.containers;
  if (!Array.isArray(containers)) throw new ImportFailure("unreadable", "StorableSidebar.json is not an Arc sidebar");
  const box = mainContainer(containers);
  const out: ArcSidebar = { spaces: [], favorites: {} };
  if (!box) return out;
  const items = new Items(objects(box.items));
  let untitled = 0;
  for (const space of objects(box.spaces)) {
    const id = text(space.id);
    if (id === undefined) continue;
    const roots = containerIDs(space);
    const seen = new Set<string>();
    const pinned = (roots.get("pinned") ?? []).flatMap((c) => tree(c, items, seen));
    const tabs = (roots.get("unpinned") ?? []).flatMap((c) => flatTabs(c, items, seen, false));
    const info = record(space.customInfo);
    const icon = record(info?.iconType);
    const name = nonEmpty(space.title) ?? `Space ${++untitled}`;
    const theme = boundedTheme(info?.windowTheme);
    const mid = midTone(theme);
    const colors = gradient(theme);
    const glyph = emoji(icon);
    const iconName = text(icon?.icon);
    const json = themeJson(theme);
    out.spaces.push({
      id,
      name,
      profileId: profileDirectory(space.profile) ?? "Default",
      pinned,
      tabs,
      ...(mid !== undefined ? { color: mid } : {}),
      ...(colors !== undefined ? { colors } : {}),
      ...(glyph !== undefined ? { emoji: glyph } : {}),
      ...(iconName !== undefined ? { icon: iconName } : {}),
      ...(json !== undefined ? { theme: json } : {}),
    });
  }
  for (const [descriptor, container] of pairs(box.topAppsContainerIDs)) {
    const profile = profileDirectory(descriptor);
    if (profile === undefined || typeof container !== "string") continue;
    const tabs = flatTabs(container, items, new Set(), true, false);
    if (tabs.length) out.favorites[profile] = [...(out.favorites[profile] ?? []), ...tabs];
  }
  return out;
}
