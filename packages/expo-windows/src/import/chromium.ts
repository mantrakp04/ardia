import { entries, join, readJson, rowsOf, type ImportHost } from "./host";
import {
  checkCancelled,
  folder,
  fromUnixMicros,
  fromWebKit,
  ImportFailure,
  isWebUrl,
  link,
  toWebKit,
  type BookmarkNode,
  type BookmarkRole,
  type Favicon,
  type HistoryEntry,
  type Observer,
  type Options,
  type Result,
} from "./model";
import { withSnapshot } from "./sqlite";

const ROOTS: { key: string; role: BookmarkRole; title: string }[] = [
  { key: "bookmark_bar", role: "toolbar", title: "Bookmarks Bar" },
  { key: "other", role: "other", title: "Other Bookmarks" },
  { key: "synced", role: "mobile", title: "Mobile Bookmarks" },
];

type Json = Record<string, unknown>;
const isJson = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

function node(json: Json): BookmarkNode | undefined {
  const title = typeof json.name === "string" ? json.name : "";
  const added = fromWebKit(typeof json.date_added === "string" ? json.date_added : undefined);
  if (json.type === "url") return typeof json.url === "string" && json.url ? link(title, json.url, added) : undefined;
  if (json.type !== "folder") return undefined;
  const kids = (Array.isArray(json.children) ? json.children.filter(isJson) : []).flatMap((c) => node(c) ?? []);
  return folder(title, kids, added === undefined ? {} : { dateAdded: added });
}

export function parseChromiumBookmarks(json: unknown): BookmarkNode {
  const roots = isJson(json) && isJson(json.roots) ? json.roots : undefined;
  if (!roots) throw new ImportFailure("unreadable", "Bookmarks file is not Chromium bookmarks JSON");
  const children: BookmarkNode[] = [];
  for (const root of ROOTS) {
    const raw = roots[root.key];
    const made = isJson(raw) ? node(raw) : undefined;
    if (!made?.children?.length) continue;
    const name = isJson(raw) && typeof raw.name === "string" && raw.name ? raw.name : root.title;
    children.push({ ...made, role: root.role, title: name });
  }
  return folder("Bookmarks", children);
}

export async function chromiumBookmarks(host: ImportHost, profile: string): Promise<BookmarkNode> {
  const names = new Set((await entries(host, profile)).map((e) => e.name));
  if (!names.has("Bookmarks") && !names.has("AccountBookmarks")) throw new ImportFailure("notFound", "No bookmarks in this profile");
  const result = names.has("Bookmarks") ? parseChromiumBookmarks(await readJson(host, join(profile, "Bookmarks"))) : folder("Bookmarks", []);
  if (names.has("AccountBookmarks")) {
    let extra: BookmarkNode | undefined;
    try {
      extra = parseChromiumBookmarks(await readJson(host, join(profile, "AccountBookmarks")));
    } catch {
      extra = undefined;
    }
    for (const part of extra?.children ?? []) {
      const same = result.children?.find((c) => c.role === part.role);
      if (same) same.children = [...(same.children ?? []), ...(part.children ?? [])];
      else result.children?.push(part);
    }
  }
  return result;
}

const HISTORY_PAGE = 5000;
const WEB_ONLY = "(url LIKE 'http://%' OR url LIKE 'https://%')";

export async function readHistory(
  host: ImportHost,
  file: string,
  flavor: "chromium" | "firefox",
  options: Options,
  observer: Observer,
  browserName: string,
): Promise<{ entries: HistoryEntry[]; count: number }> {
  const args: number[] = [];
  let sql: string;
  let table: string;
  if (flavor === "chromium") {
    table = "urls";
    let where = `hidden = 0 AND last_visit_time > 0 AND ${WEB_ONLY}`;
    if (options.historySince !== undefined) {
      where += " AND last_visit_time >= ?";
      args.push(toWebKit(options.historySince));
    }
    sql = `SELECT url, title, visit_count, last_visit_time AS last, typed_count AS typed FROM urls WHERE ${where} ORDER BY last_visit_time DESC, id DESC`;
  } else {
    table = "moz_places";
    let where = `hidden = 0 AND visit_count > 0 AND last_visit_date IS NOT NULL AND ${WEB_ONLY}`;
    if (options.historySince !== undefined) {
      where += " AND last_visit_date >= ?";
      args.push(Math.round(options.historySince * 1000));
    }
    sql = `SELECT url, title, visit_count, last_visit_date AS last, typed FROM moz_places WHERE ${where} ORDER BY last_visit_date DESC, id DESC`;
  }
  return withSnapshot(host, file, browserName, async (read) => {
    const [tables, counted] = await read([
      { sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?", args: [table] },
      { sql: `SELECT count(*) AS n FROM (${sql})`, args },
    ]);
    if (!rowsOf(tables).length) throw new ImportFailure("unreadable", `${flavor === "chromium" ? "History" : "places.sqlite"} has no ${table} table`);
    checkCancelled(observer);
    const total = rowsOf(counted)[0]?.int("n") ?? 0;
    const expected = options.historyLimit !== undefined ? Math.min(options.historyLimit, total) : total;
    observer.progress({ kind: "history", phase: "start", processed: 0, total: expected });
    const all: HistoryEntry[] = [];
    const chunkSize = Math.max(1, options.chunkSize ?? 1000);
    const stream = !!options.streamHistory && !!observer.history;
    let chunk: HistoryEntry[] = [];
    let count = 0;
    const pageSize = Math.max(1, options.historyPage ?? HISTORY_PAGE);
    for (let offset = 0; offset < expected; offset += pageSize) {
      const page = Math.min(pageSize, expected - offset);
      const [rows] = await read([{ sql: `${sql} LIMIT ? OFFSET ?`, args: [...args, page, offset] }]);
      checkCancelled(observer);
      const pageRows = rowsOf(rows);
      for (const row of pageRows) {
        const url = row.text("url");
        if (!url || !isWebUrl(url)) continue;
        const time = row.int("last");
        const typed = row.int("typed");
        const entry: HistoryEntry = {
          url,
          title: row.text("title") ?? "",
          visits: Math.max(1, row.int("visit_count") ?? 1),
          lastVisit: (flavor === "chromium" ? fromWebKit(time) : fromUnixMicros(time)) ?? 0,
          ...(typed !== undefined ? { typedCount: typed } : {}),
        };
        count += 1;
        if (stream) {
          chunk.push(entry);
          if (chunk.length >= chunkSize) {
            observer.history!(chunk);
            chunk = [];
            observer.progress({ kind: "history", phase: "progress", processed: count, total: expected });
          }
        } else {
          all.push(entry);
          if (count % chunkSize === 0) observer.progress({ kind: "history", phase: "progress", processed: count, total: expected });
        }
      }
      if (pageRows.length < page) break;
    }
    if (stream && chunk.length) observer.history!(chunk);
    observer.progress({ kind: "history", phase: "end", processed: count, total: count });
    return { entries: all, count };
  });
}

const MAXIMUM_PAGES = 1000;
const MAXIMUM_PNG_BYTES = 16 * 1024;
const MAXIMUM_TOTAL_BYTES = 6 * 1024 * 1024;
const PREFERRED_WIDTH = 32;
const PNG_BASE64_PREFIX = "iVBORw0KGgo";

export function faviconPages(result: Result): string[] {
  const links = (n: BookmarkNode): string[] => (n.type === "url" ? (n.url ? [n.url] : []) : (n.children ?? []).flatMap(links));
  const toolbar = (result.bookmarks?.children ?? []).filter((c) => c.role === "toolbar").flatMap(links);
  return [...result.favorites.map((t) => t.url), ...result.spaces.flatMap((s) => [...s.pinned.flatMap(links), ...s.tabs.map((t) => t.url)]), ...result.tabs.map((t) => t.url), ...toolbar];
}

const originOf = (page: string) => {
  const m = /^(https?):\/\/([^/?#:]+)(:\d+)?/i.exec(page);
  return m ? `${m[1]!.toLowerCase()}://${m[2]!.toLowerCase()}${m[3] ?? ""}` : undefined;
};

const ICON_SELECT = (condition: string, order: string) => `SELECT favicons.url AS icon, favicon_bitmaps.image_data AS png FROM icon_mapping
  JOIN favicons ON favicons.id = icon_mapping.icon_id
  JOIN favicon_bitmaps ON favicon_bitmaps.icon_id = favicons.id
  WHERE ${condition} AND favicons.icon_type = 1 AND length(favicon_bitmaps.image_data) BETWEEN 1 AND ${MAXIMUM_PNG_BYTES}
  ORDER BY ${order} CASE WHEN favicon_bitmaps.width >= ${PREFERRED_WIDTH} THEN favicon_bitmaps.width ELSE 1000000 - favicon_bitmaps.width END`;

export async function readFavicons(host: ImportHost, profiles: string[], pages: string[]): Promise<Favicon[]> {
  const wanted = [...new Set(pages.filter(isWebUrl))].slice(0, MAXIMUM_PAGES);
  if (!wanted.length) return [];
  const found = new Map<string, Favicon>();
  let total = 0;
  for (const profile of profiles) {
    const missing = wanted.filter((p) => !found.has(p));
    if (!missing.length || total >= MAXIMUM_TOTAL_BYTES) break;
    const queries = missing.flatMap((page) => {
      const bare = page.split("#")[0]!;
      const origin = originOf(page);
      return [
        { sql: ICON_SELECT("icon_mapping.page_url = ?", ""), args: [page], limit: 1 },
        { sql: ICON_SELECT("icon_mapping.page_url = ?", ""), args: [bare], limit: 1 },
        origin
          ? { sql: ICON_SELECT("icon_mapping.page_url >= ? AND icon_mapping.page_url < ?", "icon_mapping.page_url = ? DESC, icon_mapping.id DESC,"), args: [`${origin}/`, `${origin}0`, `${origin}/`], limit: 1 }
          : { sql: "SELECT NULL AS icon, NULL AS png WHERE 0", limit: 1 },
      ];
    });
    const answer = await host.query(join(profile, "Favicons"), queries).catch(() => null);
    if (!answer || !("results" in answer)) continue;
    for (const [i, page] of missing.entries()) {
      const icon = answer.results
        .slice(i * 3, i * 3 + 3)
        .filter((r) => !r.error)
        .map((r) => rowsOf(r)[0])
        .find((row) => row?.text("icon") && row.blob("png")?.startsWith(PNG_BASE64_PREFIX));
      if (!icon) continue;
      const png = icon.blob("png")!;
      total += Math.floor((png.length * 3) / 4);
      if (total > MAXIMUM_TOTAL_BYTES) break;
      found.set(page, { page, icon: icon.text("icon")!, png });
    }
  }
  return wanted.flatMap((p) => found.get(p) ?? []);
}
