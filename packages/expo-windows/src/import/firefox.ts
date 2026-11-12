import { fromBase64, mozLz4, utf8 } from "./bytes";
import { entries, join, rowsOf, type ImportHost } from "./host";
import { folder, fromUnixMicros, ImportFailure, link, type BookmarkNode, type ImportedTab, type OpenTabs, type TabGroup } from "./model";
import { readRows } from "./sqlite";

export type FirefoxProfile = { name: string; path: string; isDefault: boolean };

const LARGEST_SESSION_BYTES = 64 << 20;

export function firefoxProfiles(ini: string): FirefoxProfile[] {
  const sections: { name: string; values: Record<string, string> }[] = [];
  for (const raw of ini.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    if (line.startsWith("[") && line.endsWith("]")) sections.push({ name: line.slice(1, -1), values: {} });
    else if (line.includes("=") && sections.length) {
      const eq = line.indexOf("=");
      sections[sections.length - 1]!.values[line.slice(0, eq)] = line.slice(eq + 1);
    }
  }
  const installDefaults = new Set(sections.filter((s) => s.name.startsWith("Install")).flatMap((s) => (s.values.Default ? [s.values.Default] : [])));
  const out: FirefoxProfile[] = [];
  for (const s of sections) {
    if (!s.name.startsWith("Profile")) continue;
    const path = s.values.Path;
    if (!path) continue;
    const isDefault = installDefaults.size ? installDefaults.has(path) : s.values.Default === "1";
    out.push({ name: s.values.Name ?? path, path, isDefault });
  }
  return out.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

const ROOTS: Record<string, { role: string; title: string }> = {
  toolbar_____: { role: "toolbar", title: "Bookmarks Toolbar" },
  menu________: { role: "menu", title: "Bookmarks Menu" },
  unfiled_____: { role: "other", title: "Other Bookmarks" },
  mobile______: { role: "mobile", title: "Mobile Bookmarks" },
};
const ROOT_ORDER = ["toolbar_____", "menu________", "unfiled_____", "mobile______"];

type PlaceRow = { id: number; type: number; parent: number; title: string; url?: string; added?: number; guid: string };

export async function firefoxBookmarks(host: ImportHost, places: string): Promise<BookmarkNode> {
  const [tables, rows] = await readRows(host, places, [
    { sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='moz_bookmarks'" },
    {
      sql: "SELECT b.id, b.type, b.parent, b.title, p.url, b.dateAdded, b.guid FROM moz_bookmarks b LEFT JOIN moz_places p ON b.fk = p.id ORDER BY b.parent, b.position",
    },
  ]);
  if (!rowsOf(tables).length) throw new ImportFailure("unreadable", "places.sqlite has no bookmarks");
  const children = new Map<number, PlaceRow[]>();
  let rootId: number | undefined;
  for (const r of rowsOf(rows)) {
    const added = r.int("dateAdded");
    const row: PlaceRow = { id: r.int("id") ?? 0, type: r.int("type") ?? 0, parent: r.int("parent") ?? 0, title: r.text("title") ?? "", url: r.text("url"), added: fromUnixMicros(added), guid: r.text("guid") ?? "" };
    if (row.guid === "root________") rootId = row.id;
    else children.set(row.parent, [...(children.get(row.parent) ?? []), row]);
  }
  if (rootId === undefined) throw new ImportFailure("unreadable", "places.sqlite has no bookmarks root");
  const build = (parent: number, depth: number): BookmarkNode[] =>
    depth >= 64
      ? []
      : (children.get(parent) ?? []).flatMap((row): BookmarkNode[] => {
          if (row.type === 1) return row.url && !row.url.startsWith("place:") ? [link(row.title, row.url, row.added)] : [];
          if (row.type === 2) return [folder(row.title, build(row.id, depth + 1), row.added === undefined ? {} : { dateAdded: row.added })];
          return [];
        });
  const top: BookmarkNode[] = [];
  const rank = (guid: string) => (ROOT_ORDER.includes(guid) ? ROOT_ORDER.indexOf(guid) : 99);
  for (const row of [...(children.get(rootId) ?? [])].sort((a, b) => rank(a.guid) - rank(b.guid))) {
    const root = ROOTS[row.guid];
    if (!root) continue;
    const kids = build(row.id, 0);
    if (kids.length) top.push(folder(root.title, kids, { role: root.role, ...(row.added === undefined ? {} : { dateAdded: row.added }) }));
  }
  return folder("Bookmarks", top);
}

const SESSION_CANDIDATES = ["sessionstore-backups\\recovery.jsonlz4", "sessionstore.jsonlz4", "sessionstore-backups\\previous.jsonlz4"];

export async function firefoxSessionFile(host: ImportHost, profile: string): Promise<string | undefined> {
  let best: { path: string; modified: number } | undefined;
  for (const candidate of SESSION_CANDIDATES) {
    const path = join(profile, candidate);
    const slash = path.lastIndexOf("\\");
    const name = path.slice(slash + 1);
    const found = (await entries(host, path.slice(0, slash))).find((e) => !e.dir && e.name === name);
    if (found && (!best || found.modified > best.modified)) best = { path, modified: found.modified };
  }
  return best?.path;
}

type Json = Record<string, unknown>;
const records = (value: unknown): Json[] => (Array.isArray(value) ? value.filter((v): v is Json => typeof v === "object" && v !== null) : []);

export function firefoxSession(json: unknown): OpenTabs {
  const windows = records((json as Json | null)?.windows);
  if (!Array.isArray((json as Json | null)?.windows)) throw new ImportFailure("unreadable", "Session store has no windows");
  const tabs: ImportedTab[] = [];
  const groups: TabGroup[] = [];
  windows.forEach((window, w) => {
    const selected = typeof window.selected === "number" ? (window.selected > 0 ? window.selected - 1 : -1) : 0;
    records(window.tabs).forEach((tab, position) => {
      if (tab.hidden === true) return;
      const history = records(tab.entries);
      if (!history.length) return;
      const oneBased = typeof tab.index === "number" ? tab.index : history.length;
      const entry = history[Math.min(Math.max(oneBased, 1), history.length) - 1]!;
      const url = typeof entry.url === "string" ? entry.url : "";
      if (!url) return;
      tabs.push({
        url,
        title: typeof entry.title === "string" ? entry.title : "",
        pinned: tab.pinned === true,
        ...(typeof tab.groupId === "string" ? { groupId: tab.groupId } : {}),
        windowIndex: w,
        active: position === selected,
        ...(typeof tab.lastAccessed === "number" ? { lastActive: tab.lastAccessed } : {}),
      });
    });
    for (const g of records(window.groups)) {
      if (typeof g.id !== "string") continue;
      groups.push({ id: g.id, title: typeof g.name === "string" ? g.name : "", color: typeof g.color === "string" ? g.color : "grey", collapsed: g.collapsed === true });
    }
  });
  return { tabs, groups };
}

export async function loadFirefoxSession(host: ImportHost, profile: string): Promise<OpenTabs> {
  const file = await firefoxSessionFile(host, profile);
  if (!file) throw new ImportFailure("notFound", "No session store in this profile");
  const base64 = await host.readBase64(file, LARGEST_SESSION_BYTES);
  const plain = base64 == null ? undefined : mozLz4(fromBase64(base64));
  if (!plain) throw new ImportFailure("unreadable", "Couldn't decompress the session store");
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8(plain));
  } catch {
    throw new ImportFailure("unreadable", "Session store has no windows");
  }
  return firefoxSession(parsed);
}
