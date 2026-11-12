import { folder, ImportFailure, link, linkCount, type BookmarkNode, type Credential } from "./model";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#[xX][0-9a-fA-F]{1,8}|#\d{1,9}|[a-zA-Z]{2,8});/g, (whole, name: string) => {
    if (name.startsWith("#")) {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name] ?? whole;
  });
}

type Token = { open: boolean; name: string; attrs: Record<string, string>; start: number; end: number };

const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z0-9]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function tokens(html: string): Token[] {
  const out: Token[] = [];
  for (const m of html.matchAll(TAG)) {
    if (!m[2]) continue;
    const attrs: Record<string, string> = {};
    for (const a of (m[3] ?? "").matchAll(ATTR)) attrs[a[1]!.toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? "";
    out.push({ open: m[1] !== "/", name: m[2].toLowerCase(), attrs, start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

const STOPS = new Set(["dt", "dl", "h3", "a"]);

function textAfter(html: string, list: Token[], i: number, name: string): string {
  const from = list[i]!.end;
  for (let j = i + 1; j < list.length; j++) {
    const t = list[j]!;
    if ((!t.open && t.name === name) || (t.open && STOPS.has(t.name))) return html.slice(from, t.start).replace(/<[^>]*>/g, "");
  }
  return html.slice(from).replace(/<[^>]*>/g, "");
}

const seconds = (value: string | undefined) => {
  const n = value ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n * 1000 : undefined;
};

export function parseNetscape(html: string): BookmarkNode {
  const stack: BookmarkNode[] = [folder("Bookmarks", [])];
  const top = () => stack[stack.length - 1]!;
  let pending: BookmarkNode | undefined;
  let sawRootList = false;
  const list = tokens(html);
  list.forEach((t, i) => {
    if (t.open && t.name === "h3") {
      const added = seconds(t.attrs.add_date);
      const made = folder(decodeEntities(textAfter(html, list, i, "h3")).trim(), [], added === undefined ? {} : { dateAdded: added });
      if (t.attrs.personal_toolbar_folder?.toLowerCase() === "true" || t.attrs.id === "com.apple.FavoritesBar") made.role = "toolbar";
      else if (t.attrs.unfiled_bookmarks_folder?.toLowerCase() === "true") made.role = "other";
      else if (t.attrs.id === "com.apple.ReadingList") made.role = "readingList";
      if (pending) top().children!.push(pending);
      pending = made;
    } else if (t.open && t.name === "dl") {
      if (pending) {
        stack.push(pending);
        pending = undefined;
      } else if (!sawRootList) sawRootList = true;
      else stack.push(folder("", []));
    } else if (!t.open && t.name === "dl") {
      if (pending) {
        top().children!.push(pending);
        pending = undefined;
      }
      if (stack.length > 1) {
        const done = stack.pop()!;
        top().children!.push(done);
      }
    } else if (t.open && t.name === "a") {
      const href = t.attrs.href === undefined ? "" : decodeEntities(t.attrs.href);
      if (!href) return;
      if (pending) {
        top().children!.push(pending);
        pending = undefined;
      }
      const title = decodeEntities(textAfter(html, list, i, "a")).trim();
      top().children!.push(link(title || href, href, seconds(t.attrs.add_date)));
    }
  });
  if (pending) top().children!.push(pending);
  while (stack.length > 1) {
    const done = stack.pop()!;
    top().children!.push(done);
  }
  return stack[0]!;
}

export function bookmarksFromHtml(html: string, name: string): BookmarkNode {
  const root = parseNetscape(html);
  if (linkCount(root) === 0 && !root.children?.length) throw new ImportFailure("unreadable", `${name} has no bookmarks`);
  return root;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.startsWith("﻿") ? text.slice(1) : text;
  const endRow = () => {
    row.push(field);
    field = "";
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      if (input[i + 1] === "\n") i++;
      endRow();
    } else if (c === "\n") endRow();
    else field += c;
  }
  if (field || row.length) endRow();
  return rows;
}

const URL_KEYS = ["url", "login_uri", "website", "web site", "origin", "hostname", "login url"];
const USER_KEYS = ["username", "login_username", "login", "user", "email", "user name"];
const PASS_KEYS = ["password", "login_password", "pass"];
const TITLE_KEYS = ["name", "title"];
const NOTE_KEYS = ["note", "notes", "extra"];

export function passwordsFromCsv(text: string): Credential[] {
  const rows = parseCsv(text);
  const header = rows[0]?.map((h) => h.trim().toLowerCase());
  if (!header) throw new ImportFailure("unreadable", "The file is empty");
  const column = (keys: string[]) => keys.map((k) => header.indexOf(k)).find((i) => i >= 0);
  const url = column(URL_KEYS);
  const pass = column(PASS_KEYS);
  if (url === undefined || pass === undefined) throw new ImportFailure("unsupported", "This CSV doesn't have url and password columns");
  const user = column(USER_KEYS);
  const title = column(TITLE_KEYS);
  const note = column(NOTE_KEYS);
  const at = (name: string) => (header.includes(name) ? header.indexOf(name) : undefined);
  const otp = at("otpauth");
  const realm = at("httprealm");
  const created = at("timecreated");
  const lastUsed = at("timelastused");
  const field = (row: string[], i: number | undefined) => (i === undefined || i >= row.length || row[i] === "" ? undefined : row[i]);
  const number = (value: string | undefined) => (value === undefined || !Number.isFinite(Number(value)) ? undefined : Number(value));
  const out: Credential[] = [];
  for (const row of rows.slice(1)) {
    const site = field(row, url);
    const password = field(row, pass);
    if (!site || !password) continue;
    const optional: Partial<Credential> = {
      realm: field(row, realm),
      title: field(row, title),
      note: field(row, note),
      otpAuth: field(row, otp),
      created: number(field(row, created)),
      lastUsed: number(field(row, lastUsed)),
    };
    out.push({ url: site, username: field(row, user) ?? "", password, ...Object.fromEntries(Object.entries(optional).filter(([, v]) => v !== undefined)) });
  }
  return out;
}
