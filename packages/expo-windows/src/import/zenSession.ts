import type { SpaceSuggestion } from "@ardia/import";
import { rgbHex } from "./arcSidebar";
import { fromBase64, startsWith } from "./bytes";
import { folder, ImportFailure, isWebUrl, link, type BookmarkNode, type Favicon, type ImportedTab } from "./model";

export type Json = Record<string, unknown>;

export type ZenSidebar = { spaces: SpaceSuggestion[]; essentials: ImportedTab[]; favicons: Favicon[]; separateEssentials: boolean };

type Folder = { id: string; name: string; parent?: string; space?: string; previous: string | null | undefined; live: boolean; split: boolean };
type Entry = { key?: string; node: BookmarkNode };

const MAXIMUM_PNG_BYTES = 16 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const PNG_PREFIX = "data:image/png;base64,";

export const record = (value: unknown): Json | undefined => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : undefined);
export const objects = (value: unknown): Json[] => (Array.isArray(value) ? value.map(record).filter((v): v is Json => v !== undefined) : []);
export const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);
const flag = (value: unknown) => value === true || value === "true";

export function container(value: unknown): number | undefined {
  const id = typeof value === "number" ? Math.trunc(value) : typeof value === "string" && /^[+-]?\d+$/.test(value) ? Number(value) : undefined;
  return id !== undefined && id > 0 ? id : undefined;
}

const EMOJI_RANGES: [number, number][] = [
  [0xa9, 0xa9],
  [0xae, 0xae],
  [0x203c, 0x203c],
  [0x2049, 0x2049],
  [0x2122, 0x2122],
  [0x2139, 0x2139],
  [0x2194, 0x21aa],
  [0x231a, 0x23ff],
  [0x24c2, 0x24c2],
  [0x25aa, 0x27bf],
  [0x2934, 0x2935],
  [0x2b05, 0x2b55],
  [0x3030, 0x3030],
  [0x303d, 0x303d],
  [0x3297, 0x3299],
  [0x1f000, 0x1faff],
];

const isEmojiScalar = (cp: number) => cp > 0x7f && EMOJI_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
const joinsPrevious = (cp: number) => cp === 0x200d || cp === 0xfe0e || cp === 0xfe0f || cp === 0x20e3 || (cp >= 0x1f3fb && cp <= 0x1f3ff) || (cp >= 0xe0020 && cp <= 0xe007f);
const regional = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff;

function clusterCount(s: string): number {
  let count = 0;
  let previous: number | undefined;
  let pairedRegional = false;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const joined: boolean = previous !== undefined && (joinsPrevious(cp) || previous === 0x200d || (regional(cp) && regional(previous) && !pairedRegional));
    pairedRegional = joined && regional(cp);
    if (!joined) count++;
    previous = cp;
  }
  return count;
}

export function zenEmoji(value: unknown): string | undefined {
  const icon = text(value);
  if (!icon || clusterCount(icon) > 4 || icon.includes("/") || icon.includes(":")) return undefined;
  return [...icon].some((ch) => isEmojiScalar(ch.codePointAt(0)!)) ? icon : undefined;
}

export function zenGradient(theme: unknown): string[] {
  const stops = objects(record(theme)?.gradientColors);
  const ordered = [...stops.filter((s) => s.isPrimary === true), ...stops.filter((s) => s.isPrimary !== true)];
  return ordered.flatMap((stop) => {
    const c = stop.c;
    if (Array.isArray(c) && c.length >= 3 && c.every((n) => typeof n === "number")) {
      const [r, g, b] = c as number[];
      return [rgbHex(r! / 255, g! / 255, b! / 255)];
    }
    const css = text(c);
    if (css && /^#[0-9a-fA-F]{6}$/.test(css)) return [css.toUpperCase()];
    return [];
  });
}

function png(value: unknown): string | undefined {
  const image = text(value);
  if (!image?.startsWith(PNG_PREFIX) || image.length > PNG_PREFIX.length + Math.floor((MAXIMUM_PNG_BYTES + 2) / 3) * 4) return undefined;
  const encoded = image.slice(PNG_PREFIX.length);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) return undefined;
  const bytes = fromBase64(encoded);
  return bytes.length <= MAXIMUM_PNG_BYTES && startsWith(bytes, PNG_SIGNATURE) ? encoded : undefined;
}

function entryIndex(oneBased: unknown, count: number) {
  const n = typeof oneBased === "number" && Number.isInteger(oneBased) ? oneBased : count;
  return Math.min(Math.max(n, 1), count) - 1;
}

function pageOf(tab: Json, pinned: boolean): Json | undefined {
  const initial = record(record(tab._zenPinnedInitialState)?.entry);
  if (pinned && initial && text(initial.url) !== undefined) return initial;
  const history = objects(tab.entries);
  return history.length ? history[entryIndex(tab.index, history.length)] : undefined;
}

function originIcon(url: string): string | undefined {
  if (!isWebUrl(url)) return undefined;
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(?:[^/?#@]*@)?([^/?#:]+)(?::(\d+))?/.exec(url);
  return m ? `${m[1]}://${m[2]}${m[3] ? `:${Number(m[3])}` : ""}/favicon.ico` : undefined;
}

export function parseZenSession(top: unknown, profileId: string, storedSpaces: Json[] = []): ZenSidebar {
  const root = record(top);
  if (!root) throw new ImportFailure("unreadable", "Zen's session store is malformed");
  const windows = root.windows === undefined ? [root] : objects(root.windows).filter((w) => w.isPopup !== true && w.isTaskbarTab !== true && w.isPrivate !== true);
  const out: ZenSidebar = { spaces: [], essentials: [], favicons: [], separateEssentials: true };
  const declared = windows.flatMap((w) => objects(w.spaces));
  for (const space of declared.length ? declared : storedSpaces) {
    const id = text(space.uuid);
    if (id === undefined || out.spaces.some((s) => s.id === id)) continue;
    const colors = zenGradient(space.theme);
    const glyph = zenEmoji(space.icon);
    const box = container(space.containerTabId);
    out.spaces.push({
      id,
      name: text(space.name) ?? `Space ${out.spaces.length + 1}`,
      ...(colors.length ? { color: colors[0], colors } : {}),
      ...(glyph !== undefined ? { emoji: glyph } : {}),
      profileId,
      pinned: [],
      tabs: [],
      ...(box !== undefined ? { container: box } : {}),
    });
  }
  if (!out.spaces.length) return out;

  const folders = new Map<string, Folder>();
  for (const window of windows) {
    for (const f of objects(window.folders)) {
      const id = text(f.id);
      if (id === undefined || folders.has(id)) continue;
      const previousInfo = record(f.prevSiblingInfo);
      folders.set(id, {
        id,
        name: text(f.name) ?? "Folder",
        parent: text(f.parentId),
        space: text(f.workspaceId),
        previous: previousInfo ? (text(previousInfo.id) ?? null) : undefined,
        live: f.isLiveFolder === true,
        split: f.splitViewGroup === true,
      });
    }
  }
  const folderOrder = [...folders.keys()];

  const spaceIndex = (id: string | undefined, tabContainer?: number) => {
    const byId = id === undefined ? -1 : out.spaces.findIndex((s) => s.id === id);
    if (byId >= 0) return byId;
    const byContainer = tabContainer === undefined ? -1 : out.spaces.findIndex((s) => s.container === tabContainer);
    return byContainer >= 0 ? byContainer : 0;
  };

  const seenTabs = new Set<string>();
  const essentialPages = new Set<string>();
  const rootPins = new Map<number, Entry[]>();
  const folderPins = new Map<string, Entry[]>();
  const folderSpace = new Map<string, string>();
  const iconPages = new Set<string>();

  for (const window of windows) {
    for (const tab of objects(window.tabs)) {
      if (tab.zenIsEmpty === true || tab.zenIsGlance === true || text(tab.zenLiveFolderItemId) !== undefined) continue;
      const syncId = text(tab.zenSyncId) ?? text(tab.zenPinnedId);
      if (syncId !== undefined) {
        if (seenTabs.has(syncId)) continue;
        seenTabs.add(syncId);
      }
      const essential = flag(tab.zenEssential);
      const pinned = essential || tab.pinned === true;
      const page = pageOf(tab, pinned);
      const url = text(page?.url);
      if (!page || url === undefined) continue;
      const title = typeof page.title === "string" ? page.title : "";
      const label = text(tab.zenStaticLabel);
      const workspace = text(tab.zenWorkspace);
      const tabContainer = container(tab.userContextId);
      const icon = iconPages.has(url) ? undefined : png(pinned ? (record(tab._zenPinnedInitialState)?.image ?? tab.image) : tab.image);
      const iconUrl = icon ? originIcon(url) : undefined;
      if (icon && iconUrl) {
        iconPages.add(url);
        out.favicons.push({ page: url, icon: iconUrl, png: icon });
      }
      if (essential) {
        const key = `${tabContainer ?? 0} ${url}`;
        if (!essentialPages.has(key)) {
          essentialPages.add(key);
          out.essentials.push({
            url,
            title,
            pinned: true,
            windowIndex: 0,
            active: false,
            ...(label !== undefined ? { customTitle: label } : {}),
            ...(tabContainer !== undefined ? { container: tabContainer } : {}),
          });
        }
      } else if (pinned) {
        const node = label !== undefined ? { ...link(label, url), pageTitle: title } : link(title, url);
        const group = text(tab.groupId);
        if (group !== undefined && folders.has(group)) {
          folderPins.set(group, [...(folderPins.get(group) ?? []), { key: syncId, node }]);
          if (workspace !== undefined && !folderSpace.has(group)) folderSpace.set(group, workspace);
        } else {
          const index = spaceIndex(workspace, tabContainer);
          rootPins.set(index, [...(rootPins.get(index) ?? []), { key: syncId, node }]);
        }
      } else {
        out.spaces[spaceIndex(workspace, tabContainer)]!.tabs.push({
          url,
          title,
          pinned: false,
          windowIndex: 0,
          active: false,
          ...(label !== undefined ? { customTitle: label } : {}),
          ...(typeof tab.lastAccessed === "number" ? { lastActive: tab.lastAccessed } : {}),
        });
      }
    }
  }

  const insert = (list: Entry[], added: Entry[], after: string) => {
    const previous = folders.get(after)?.previous;
    if (previous === undefined) return [...list, ...added];
    if (previous === null) return [...added, ...list];
    let at = list.length;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]!.key === previous) {
        at = i + 1;
        break;
      }
    }
    return [...list.slice(0, at), ...added, ...list.slice(at)];
  };

  const placed = new Set<string>();
  const contents = (id: string, depth: number): Entry[] => {
    let list = folderPins.get(id) ?? [];
    if (depth >= 32) return list;
    for (const child of folderOrder) {
      if (folders.get(child)?.parent === id && !placed.has(child)) list = insert(list, build(child, depth + 1), child);
    }
    return list;
  };
  const build = (id: string, depth: number): Entry[] => {
    const f = folders.get(id);
    if (!f || f.live || placed.has(id)) return [];
    placed.add(id);
    const inside = contents(id, depth);
    if (f.split) return inside;
    return [{ key: id, node: folder(f.name, inside.map((e) => e.node)) }];
  };
  const spaceOf = (id: string, depth = 0): string | undefined => {
    const f = folders.get(id);
    if (depth >= 32 || !f) return undefined;
    return f.space ?? folderSpace.get(id) ?? (f.parent !== undefined ? spaceOf(f.parent, depth + 1) : undefined);
  };

  const roots = folderOrder.filter((id) => {
    const parent = folders.get(id)?.parent;
    return parent === undefined || !folders.has(parent);
  });
  for (const id of [...roots, ...folderOrder]) {
    if (placed.has(id)) continue;
    const index = spaceIndex(spaceOf(id));
    rootPins.set(index, insert(rootPins.get(index) ?? [], build(id, 0), id));
  }
  for (const [index, list] of rootPins) out.spaces[index]!.pinned = list.map((e) => e.node);
  return out;
}
