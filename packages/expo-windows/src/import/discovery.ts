import { BROWSERS, type Browser } from "./browsers";
import { firefoxProfiles, firefoxSessionFile } from "./firefox";
import { entries, join, readJson, type ImportHost } from "./host";
import { hexColor, ImportFailure, type ImportKind, type Profile, type Source } from "./model";
import { latestSessionFile } from "./sessions";
import { attachArcSpaces, zenProfileSpaces } from "./sidebars";

type Info = Record<string, unknown>;

const PROFILE_MARKERS = ["Preferences", "Bookmarks", "History", "Login Data"];

export const dataDirectory = (host: ImportHost, browser: Browser) => join(browser.root === "local" ? host.localAppData : host.roamingAppData, browser.path);

const has = (names: Set<string>, ...wanted: string[]) => wanted.some((n) => names.has(n.toLowerCase()));

async function namesIn(host: ImportHost, folder: string): Promise<Set<string>> {
  return new Set((await entries(host, folder)).map((e) => e.name.toLowerCase()));
}

async function isProfile(host: ImportHost, folder: string) {
  return has(await namesIn(host, folder), ...PROFILE_MARKERS);
}

async function chromiumKinds(host: ImportHost, folder: string, arc: boolean): Promise<ImportKind[]> {
  const names = await namesIn(host, folder);
  const network = has(names, "Network") ? await namesIn(host, join(folder, "Network")) : new Set<string>();
  const kinds: ImportKind[] = [];
  if (has(names, "Bookmarks", "AccountBookmarks")) kinds.push("bookmarks");
  if (has(names, "History")) kinds.push("history");
  if (!arc && (await latestSessionFile(host, folder))) kinds.push("tabs");
  if (has(names, "Login Data", "Login Data For Account")) kinds.push("passwords");
  if (has(network, "Cookies") || has(names, "Cookies")) kinds.push("cookies");
  return kinds;
}

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
const record = (value: unknown): Info => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Info) : {});

export async function chromiumProfiles(host: ImportHost, browser: Browser, only?: string): Promise<Profile[]> {
  const root = dataDirectory(host, browser);
  const state = record(record(await readJson(host, join(root, "Local State"))).profile);
  const infoCache = record(state.info_cache);
  const order = Array.isArray(state.profiles_order) ? state.profiles_order.filter((d): d is string => typeof d === "string") : [];
  const lastUsed = text(state.last_used);
  const dirs: string[] = [];
  const add = (dir: string) => !dirs.includes(dir) && dirs.push(dir);
  if (browser.rootIsProfile && (await isProfile(host, root))) add(".");
  [...order, ...Object.keys(infoCache).sort()].forEach(add);
  for (const e of (await entries(host, root)).filter((e) => e.dir).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name === "Default" || e.name.startsWith("Profile ")) add(e.name);
  }
  if (browser.rootIsProfile) {
    for (const e of await entries(host, join(root, "_side_profiles"))) if (e.dir) add(`_side_profiles\\${e.name}`);
  }
  const out: Profile[] = [];
  let fallback = 0;
  for (const dir of dirs) {
    if (dir.includes("..") || dir.includes(":")) continue;
    const path = dir === "." ? root : join(root, dir);
    if (!(await isProfile(host, path))) continue;
    fallback += 1;
    if (only !== undefined && only !== dir) continue;
    const info = record(infoCache[dir] ?? (dir === "." ? (infoCache.Default ?? infoCache[""]) : undefined));
    const name = text(info.name) ?? (dir === "Default" || dir === "." ? "Default" : `Profile ${fallback}`);
    const skColor = typeof info.profile_highlight_color === "number" ? info.profile_highlight_color : typeof info.default_avatar_fill_color === "number" ? info.default_avatar_fill_color : undefined;
    const pictures = await namesIn(host, path);
    out.push({
      id: dir,
      name,
      path,
      ...(text(info.user_name) ? { email: text(info.user_name) } : {}),
      ...(has(pictures, "Google Profile Picture.png") ? { avatarPath: join(path, "Google Profile Picture.png") } : {}),
      ...(skColor !== undefined && skColor >>> 0 !== 0xff000000 ? { color: hexColor(skColor) } : {}),
      isDefault: dir === (lastUsed ?? "Default") || (dir === "." && lastUsed === undefined),
      available: await chromiumKinds(host, path, browser.family === "arc"),
      tabsNeedKey: false,
    });
  }
  return out;
}

async function firefoxSource(host: ImportHost, browser: Browser): Promise<Profile[]> {
  const root = dataDirectory(host, browser);
  const ini = await host.readText(join(root, "profiles.ini"), 1 << 20).catch(() => null);
  if (ini == null) return [];
  const out: Profile[] = [];
  for (const p of firefoxProfiles(ini)) {
    if (/^[a-zA-Z]:|^[\\/]/.test(p.path) || p.path.split(/[\\/]/).includes("..")) continue;
    const dir = join(root, p.path);
    const names = await namesIn(host, dir);
    if (!names.size) continue;
    const kinds: ImportKind[] = [];
    if (has(names, "places.sqlite")) kinds.push("bookmarks", "history");
    if (await firefoxSessionFile(host, dir)) kinds.push("tabs");
    if (has(names, "logins.json", "logins.db")) kinds.push("passwords");
    if (has(names, "cookies.sqlite")) kinds.push("cookies");
    const spaces = browser.sidebar === "zen" ? await zenProfileSpaces(host, dir, p.path, kinds) : undefined;
    out.push({ id: p.path, name: p.name, path: dir, isDefault: p.isDefault, available: kinds, ...(spaces ? { spaces } : {}), tabsNeedKey: false });
  }
  return out;
}

export async function profilesOf(host: ImportHost, browser: Browser): Promise<Profile[]> {
  if (browser.family === "firefox") return firefoxSource(host, browser);
  const profiles = await chromiumProfiles(host, browser);
  return browser.sidebar === "arc" ? attachArcSpaces(host, profiles) : profiles;
}

export async function listSources(host: ImportHost): Promise<Source[]> {
  const found = await Promise.all(
    BROWSERS.map(async (browser): Promise<Source | null> => {
      const profiles = await profilesOf(host, browser).catch(() => []);
      if (!profiles.length) return null;
      return {
        id: browser.id,
        name: browser.name,
        family: browser.family,
        requiresExport: false,
        needsKeychain: false,
        needsFullDiskAccess: false,
        profiles,
        ...(browser.sidebar ? { sidebar: browser.sidebar } : {}),
        asksAppForTabs: false,
      };
    }),
  );
  return found.filter((s): s is Source => s !== null);
}

export async function profileDirectory(host: ImportHost, browser: Browser, profileId: string): Promise<{ dir: string; profile: Profile }> {
  const profile = (await profilesOf(host, browser)).find((p) => p.id === profileId);
  if (!profile) throw new ImportFailure("notFound", `Profile ${profileId} not found`);
  return { dir: profile.path, profile };
}
