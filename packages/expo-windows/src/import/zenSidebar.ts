import { fromBase64, mozLz4, utf8 } from "./bytes";
import { firefoxSessionFile } from "./firefox";
import { entries, join, readJson, rowsOf, type ImportHost } from "./host";
import { ImportFailure, type Favicon } from "./model";
import { readRows } from "./sqlite";
import { objects, parseZenSession, record, text, type Json, type ZenSidebar } from "./zenSession";

export type { ZenSidebar } from "./zenSession";

const LARGEST_SESSION_BYTES = 64 << 20;
const MAXIMUM_TOTAL_BYTES = 6 * 1024 * 1024;
const DEFAULT_CONTAINER_NAMES: Record<string, string> = {
  "user-context-personal": "Personal",
  "user-context-work": "Work",
  "user-context-banking": "Banking",
  "user-context-shopping": "Shopping",
};

const decodedBytes = (base64: string) => Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);

export function zenFavicons(sidebar: ZenSidebar, pages: string[]): Favicon[] {
  const wanted = new Set(pages);
  let total = 0;
  return sidebar.favicons.filter((icon) => {
    const size = decodedBytes(icon.png);
    if (!wanted.has(icon.page) || total + size > MAXIMUM_TOTAL_BYTES) return false;
    total += size;
    return true;
  });
}

export function separateEssentials(prefs: string | null): boolean {
  if (prefs == null) return true;
  const key = '"zen.workspaces.separate-essentials"';
  for (const line of prefs.split(/\r\n|\r|\n/)) {
    if (line.startsWith("user_pref(") && line.includes(key)) return !line.replace(/ /g, "").includes(`${key},false)`);
  }
  return true;
}

export async function zenContainerNames(host: ImportHost, profile: string): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  const top = record(await readJson(host, join(profile, "containers.json"), 4 << 20));
  for (const identity of objects(top?.identities)) {
    if (identity.public === false) continue;
    const id = typeof identity.userContextId === "number" ? Math.trunc(identity.userContextId) : undefined;
    const l10n = text(identity.l10nId) ?? text(identity.l10nID);
    const name = text(identity.name) ?? (l10n !== undefined ? DEFAULT_CONTAINER_NAMES[l10n] : undefined);
    if (id !== undefined && name !== undefined) names.set(id, name);
  }
  return names;
}

async function sessionFiles(host: ImportHost, profile: string): Promise<string[]> {
  const backups = join(profile, "zen-sessions-backup");
  const here = new Set((await entries(host, profile)).filter((e) => !e.dir).map((e) => e.name));
  const saved = (await entries(host, backups)).filter((e) => !e.dir).map((e) => e.name);
  const dated = saved
    .filter((n) => n.startsWith("zen-sessions-") && n.endsWith(".jsonlz4"))
    .sort()
    .reverse();
  const own = [...(here.has("zen-sessions.jsonlz4") ? [join(profile, "zen-sessions.jsonlz4")] : []), ...(saved.includes("clean.jsonlz4") ? [join(backups, "clean.jsonlz4")] : []), ...dated.map((n) => join(backups, n))];
  const firefox = await firefoxSessionFile(host, profile);
  return firefox ? [...own, firefox] : own;
}

async function placesWorkspaces(host: ImportHost, profile: string): Promise<Json[]> {
  const places = join(profile, "places.sqlite");
  try {
    const [table] = await readRows(host, places, [{ sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='zen_workspaces'" }]);
    if (!rowsOf(table).length) return [];
    const [rows] = await readRows(host, places, [{ sql: "SELECT * FROM zen_workspaces" }]);
    const found: { position: number; created: number; space: Json }[] = [];
    for (const r of rowsOf(rows)) {
      const uuid = r.text("uuid");
      if (uuid === undefined) continue;
      const space: Json = { uuid, containerTabId: r.int("container_id") ?? 0 };
      const name = r.text("name");
      const icon = r.text("icon");
      if (name !== undefined) space.name = name;
      if (icon !== undefined) space.icon = icon;
      const colors = r.text("theme_colors");
      if (colors !== undefined) {
        try {
          space.theme = { gradientColors: JSON.parse(colors) };
        } catch {}
      }
      found.push({ position: r.int("position") ?? Number.MAX_SAFE_INTEGER, created: r.int("created_at") ?? 0, space });
    }
    return found.sort((a, b) => a.position - b.position || a.created - b.created).map((f) => f.space);
  } catch {
    return [];
  }
}

async function readSession(host: ImportHost, file: string): Promise<unknown> {
  const base64 = await host.readBase64(file, LARGEST_SESSION_BYTES);
  const plain = base64 == null ? undefined : mozLz4(fromBase64(base64));
  if (!plain) throw new ImportFailure("unreadable", "Couldn't decompress Zen's session store");
  try {
    return JSON.parse(utf8(plain));
  } catch {
    throw new ImportFailure("unreadable", "Zen's session store is malformed");
  }
}

export async function loadZenSidebar(host: ImportHost, profile: string, profileId: string, cancelled: () => boolean = () => false): Promise<ZenSidebar> {
  const files = await sessionFiles(host, profile);
  if (!files.length) throw new ImportFailure("notFound", "No Zen session in this profile");
  const separate = separateEssentials(await host.readText(join(profile, "prefs.js"), 8 << 20).catch(() => null));
  let failure: unknown;
  let parsed = false;
  let stored: Json[] | undefined;
  for (let pass = 0; pass < 2; pass++) {
    for (const file of files) {
      if (cancelled()) throw new ImportFailure("cancelled", "Import cancelled");
      try {
        const sidebar = parseZenSession(await readSession(host, file), profileId, stored ?? []);
        parsed = true;
        sidebar.separateEssentials = separate;
        if (sidebar.spaces.length) return sidebar;
      } catch (error) {
        failure ??= error;
      }
    }
    if (pass > 0) break;
    stored = await placesWorkspaces(host, profile);
    if (!stored.length) break;
  }
  if (!parsed && failure) throw failure;
  return { spaces: [], essentials: [], favicons: [], separateEssentials: separate };
}
