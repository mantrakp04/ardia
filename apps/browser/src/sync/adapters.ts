import { addHistoryVisits, deleteHistoryUrls, deletePassword, savePassword } from "@ardia/ardiacore";
import { assignPositions, canonical, SyncNative, type Adapter, type SavedLogin, type SyncRecord } from "@ardia/sync";
import { bookmarkUuidFor, ensureRoots, isBookmarkUuid } from "../store/bookmarks";
import { MAX_HISTORY, MAX_VISIT_TIMES } from "../store/history";
import { useBrowser } from "../store/browser";
import { engineProfile } from "../store/model";
import { isPeekTab } from "../store/peek";
import { fromSync } from "../store/pinOrderChoices";
import { DEFAULT_PROFILE_ID, DEFAULT_SETTINGS, type Settings } from "../store/settings";
import { sanitizeTheme } from "../lib/profileTheme";
import { fromLegacy } from "../legacy";
import type { BookmarkNode, HistoryEntry, Profile, ProfileTheme } from "../store/types";

const store = () => useBrowser.getState();

export const inTodaysNames = (adapter: Adapter): Adapter => ({
  ...adapter,
  apply: (visible, changed, base, records) =>
    adapter.apply(new Map([...visible].map(([key, value]) => [key, fromLegacy(value)])), changed, (key) => fromLegacy(base(key)), records),
});

export const SYNCED_SETTINGS = [
  "warnBeforeQuitting",
  "warnBeforeClosingWindow",
  "searchEngine",
  "customSearchUrl",
  "customSearchEngines",
  "searchSuggestions",
  "showSelectionSearch",
  "commandBarPreference",
  "tabLayout",
  "hideToolbarWhileScrolling",
  "showSidebarButton",
  "showClearButton",
  "balancedTopApps",
  "pinnedTabIconRing",
  "selectedTabGlow",
  "pageScrollBars",
  "fadeUnloadedTabs",
  "profileIconsInSidebar",
  "warnBeforeClosingTabGroup",
  "newTabPosition",
  "newTabButtonPosition",
  "newTabOpens",
  "warnBeforeClosingLastTab",
  "undoReopensClosedTab",
  "warnBeforeMovingTabsToProfile",
  "tabReorderHaptics",
  "extendWebsiteColor",
  "cmdClickCreatesTabGroup",
  "optShiftClickOpensInGroup",
  "peekModifier",
  "splitLinkModifier",
  "autoGroupMeetingTabs",
  "cleanUpInactiveTabsAfterHours",
  "mutedSites",
  "autoPictureInPicture",
  "videoUpscaling",
  "sidebarMediaControls",
  "showFullUrl",
  "bookmarksBar",
  "appearance",
  "addressBar",
  "commandBarPlacement",
  "shortcuts",
] as const satisfies readonly (keyof Settings)[];

export const settingsAdapter: Adapter = {
  prefix: "set:",
  adoptRemoteOnJoin: true,
  extract: (base) => {
    const settings = store().settings;
    const chosen = new Set(settings.chosen ?? []);
    const inferred = new Set(settings.inferred ?? []);
    const filledIn = (name: (typeof SYNCED_SETTINGS)[number], value: unknown) => {
      if (!inferred.has(name) || JSON.stringify(value) !== JSON.stringify(DEFAULT_SETTINGS[name])) return false;
      const last = base(`set:${name}`) as { v?: unknown } | undefined;
      return last === undefined || last.v === null || last.v === undefined;
    };
    const values = new Map<string, unknown>();
    for (const name of SYNCED_SETTINGS) {
      const value = settings[name] as unknown;
      if (!chosen.has(name) || value === undefined || (value === null && DEFAULT_SETTINGS[name] !== null) || filledIn(name, value)) continue;
      values.set(`set:${name}`, { v: value });
    }
    return { values, ignore: (key) => !values.has(key) };
  },
  apply: (visible, changed) => {
    const patch: Record<string, unknown> = {};
    for (const key of changed) {
      const name = key.slice(4);
      const record = visible.get(key) as { v: unknown } | undefined;
      if (!record || !(SYNCED_SETTINGS as readonly string[]).includes(name)) continue;
      const value = record.v;
      if (value === undefined || (value === null && DEFAULT_SETTINGS[name as keyof Settings] !== null)) continue;
      patch[name] = value;
    }
    if (Object.keys(patch).length) store().updateSettings(patch as Partial<Settings>, { fromSync: true });
  },
};

export function settingsToReapply(records: Record<string, SyncRecord>): string[] {
  const settings = store().settings;
  const chosen = new Set(settings.chosen ?? []);
  return SYNCED_SETTINGS.flatMap((name) => {
    const key = `set:${name}`;
    const value = (fromLegacy(records[key]?.v) as { v?: unknown } | null | undefined)?.v;
    if (chosen.has(name) || value === undefined || (value === null && DEFAULT_SETTINGS[name] !== null)) return [];
    return canonical(value) === canonical(settings[name]) ? [] : [key];
  });
}

export type ProfileRecord = { n: string; c: Profile["color"]; i: string | null; d?: true; th?: ProfileTheme | null };

export type ProfileThemeRecord = { t: ProfileTheme } | { preset: true };

export type ThemeAngleRecord = { a?: number; d?: number };

export const themeAngleKey = (syncId: string) => `pth:${syncId}:angle`;

function withoutAngles({ angle: _angle, dark, ...theme }: ProfileTheme): ProfileTheme {
  if (!dark) return theme;
  const { angle: _darkAngle, ...darkLook } = dark;
  return { ...theme, dark: darkLook };
}

function anglesOf(theme: ProfileTheme): ThemeAngleRecord {
  return { ...(theme.angle !== undefined ? { a: theme.angle } : {}), ...(theme.dark?.angle !== undefined ? { d: theme.dark.angle } : {}) };
}

export function themeFromRecord(record: unknown, angles?: unknown): Pick<Profile, "theme"> | null {
  if (!record || typeof record !== "object") return null;
  if ("preset" in record && record.preset === true) return { theme: null };
  const theme = "t" in record ? sanitizeTheme(record.t) : null;
  if (!theme) return null;
  if (!angles || typeof angles !== "object") return { theme };
  const { a, d } = angles as Record<string, unknown>;
  const look = withoutAngles(theme);
  return { theme: sanitizeTheme({ ...look, angle: a, ...(look.dark ? { dark: { ...look.dark, angle: d } } : {}) }) };
}

export function legacyThemeOf(record: ProfileRecord): Pick<Profile, "theme"> | null {
  const theme = record.th ? sanitizeTheme(record.th) : null;
  return theme ? { theme } : null;
}

export function profilesAdapter(links: () => Record<string, { syncId: string }>): Adapter {
  const linked = () => Object.entries(links()).filter(([id]) => store().profiles[id]);
  return {
    prefix: "prof:",
    adoptRemoteOnJoin: true,
    extract: (_base, _queued, _now, known) => {
      const values = new Map<string, unknown>();
      const all = links();
      for (const [id, { syncId }] of linked()) {
        const p = store().profiles[id]!;
        const sharesSyncedData = !!p.dataId && p.dataId !== id && !!all[p.dataId] && !!store().profiles[p.dataId];
        if (sharesSyncedData && !known(`share:${syncId}`)) continue;
        values.set(`prof:${syncId}`, {
          n: p.name,
          c: p.color,
          i: p.icon,
          ...(id === DEFAULT_PROFILE_ID ? { d: true } : {}),
        } satisfies ProfileRecord);
      }
      const mine = new Set(values.keys());
      return { values, ignore: (key) => !mine.has(key) };
    },
    apply: (visible, changed, _base, records) => {
      for (const [id, { syncId }] of linked()) {
        const record = visible.get(`prof:${syncId}`) as ProfileRecord | undefined;
        if (!record || !changed.has(`prof:${syncId}`)) continue;
        const legacy = store().profiles[id]!.theme === undefined && !records.known(`pth:${syncId}`) ? legacyThemeOf(record) : null;
        store().updateProfile(id, { name: record.n, color: record.c, icon: record.i, ...legacy });
      }
    },
  };
}

export function profileThemesAdapter(
  links: () => Record<string, { syncId: string; themeAdopting?: true }>,
  records: () => Record<string, { v: unknown }> | undefined,
  adopted: (profileId: string) => void = () => {},
): Adapter {
  const linked = () => Object.entries(links()).filter(([id]) => store().profiles[id]);
  const unapplied = (key: string, base: (key: string) => unknown) => {
    const record = records()?.[key];
    return !!record && record.v !== null && canonical(record.v) !== canonical(base(key) ?? null);
  };
  return {
    prefix: "pth:",
    adoptRemoteOnJoin: true,
    extract: (base, _queued, _now, known) => {
      const values = new Map<string, unknown>();
      for (const [id, { syncId, themeAdopting }] of linked()) {
        const theme = store().profiles[id]!.theme;
        const key = `pth:${syncId}`;
        const angleKey = themeAngleKey(syncId);
        if (theme === undefined || themeAdopting || unapplied(key, base) || unapplied(angleKey, base)) continue;
        values.set(key, (theme ? { t: withoutAngles(theme) } : { preset: true }) satisfies ProfileThemeRecord);
        const angles = theme ? anglesOf(theme) : {};
        if (Object.keys(angles).length || known(angleKey)) values.set(angleKey, angles satisfies ThemeAngleRecord);
      }
      const mine = new Set(values.keys());
      return { values, ignore: (key) => !mine.has(key) };
    },
    apply: (visible, changed) => {
      for (const [id, { syncId }] of linked()) {
        const angleKey = themeAngleKey(syncId);
        if (!changed.has(`pth:${syncId}`) && !changed.has(angleKey)) continue;
        const patch = themeFromRecord(visible.get(`pth:${syncId}`), visible.get(angleKey));
        if (!patch) continue;
        store().updateProfile(id, patch);
        adopted(id);
      }
    },
  };
}

export type ShareRecord = { o: string };

type ShareLink = { syncId: string; enabled: boolean; retire?: boolean };

export function sharedDataAdapter(links: () => Record<string, ShareLink>): Adapter {
  return {
    prefix: "share:",
    adoptRemoteOnJoin: true,
    publishAfterPull: true,
    extract: (_base, _queued, _now, known) => {
      const all = links();
      const synced = (id: string) => !!store().profiles[id] && !!all[id]?.enabled && !all[id]?.retire;
      const values = new Map<string, unknown>();
      for (const [id, link] of Object.entries(all)) {
        const ownerId = store().profiles[id]?.dataId;
        if (!synced(id) || !ownerId || ownerId === id || !synced(ownerId)) continue;
        const key = `share:${link.syncId}`;
        if (!known(key)) values.set(key, { o: all[ownerId]!.syncId } satisfies ShareRecord);
      }
      return { values, ignore: (key) => !values.has(key) };
    },
    apply: () => true,
  };
}

export type DeviceRecord = { n: string };

export function deviceAdapter(deviceId: string, name: () => string, retired = false): Adapter {
  return {
    prefix: "dev:",
    extract: () => ({
      values: retired ? new Map() : new Map([[`dev:${deviceId}`, { n: name() } satisfies DeviceRecord]]),
      ignore: (key) => key !== `dev:${deviceId}`,
    }),
    apply: () => true,
  };
}

type BookmarkValue = { k: "u" | "f"; p: string; t: string; u?: string; a: number; pos: string };

export function bookmarksAdapter(profileId: string): Adapter {
  const ready = () => !!store().bookmarksReady[profileId];
  return {
    prefix: "bm:",
    extract: (base) => {
      if (!ready()) return null;
      const b = store().bookmarks;
      const roots = b.roots[profileId];
      const values = new Map<string, unknown>();
      if (!roots) return { values };
      const keyOf = (id: string) => {
        if (id === roots.bar) return "bar";
        if (id === roots.other) return "other";
        const key = b.nodes[id]?.syncKey;
        return key && bookmarkUuidFor(key) === id ? key : id;
      };
      const seen = new Set<string>();
      const walk = (folderId: string) => {
        const folder = b.nodes[folderId];
        if (folder?.kind !== "folder" || seen.has(folderId)) return;
        seen.add(folderId);
        const parent = keyOf(folderId);
        const children = folder.children.filter((id) => b.nodes[id]);
        const positions = assignPositions(
          children.map((id) => {
            const known = base(`bm:${keyOf(id)}`) as BookmarkValue | undefined;
            return known?.p === parent ? known.pos : undefined;
          }),
        );
        children.forEach((id, i) => {
          const node = b.nodes[id]!;
          values.set(`bm:${keyOf(id)}`, {
            k: node.kind === "url" ? "u" : "f",
            p: parent,
            t: node.title,
            ...(node.kind === "url" ? { u: node.url } : {}),
            a: node.addedAt,
            pos: positions[i]!,
          } satisfies BookmarkValue);
          if (node.kind === "folder") walk(id);
        });
      };
      walk(roots.bar);
      walk(roots.other);
      return { values };
    },
    apply: (visible) => {
      if (!ready()) return false;
      const s = store();
      const [b, roots] = ensureRoots(s.bookmarks, profileId);
      const values = new Map([...visible].map(([k, v]) => [bookmarkUuidFor(k.slice(3)), v as BookmarkValue]));
      const keys = new Map([...visible.keys()].map((k) => [bookmarkUuidFor(k.slice(3)), k.slice(3)]));
      const rootOf = (key: string) => (key === "bar" ? roots.bar : key === "other" ? roots.other : null);
      const parentOf = new Map<string, string>();
      for (const [id, v] of values) {
        const root = rootOf(v.p);
        const parent = root ? null : bookmarkUuidFor(v.p);
        parentOf.set(id, root ?? (parent && values.get(parent)?.k === "f" ? parent : roots.other));
      }
      for (const id of [...values.keys()].sort()) {
        const seen = new Set<string>([id]);
        for (let at = parentOf.get(id)!; parentOf.has(at); at = parentOf.get(at)!) {
          if (seen.has(at)) {
            parentOf.set(id, roots.other);
            break;
          }
          seen.add(at);
        }
      }
      const children = new Map<string, string[]>([[roots.bar, []], [roots.other, []]]);
      for (const id of values.keys()) children.set(parentOf.get(id)!, [...(children.get(parentOf.get(id)!) ?? []), id]);
      const byPosition = (a: string, z: string) => {
        const pa = values.get(a)!.pos;
        const pz = values.get(z)!.pos;
        const ka = keys.get(a)!;
        const kz = keys.get(z)!;
        return pa < pz ? -1 : pa > pz ? 1 : ka < kz ? -1 : 1;
      };
      const nodes: Record<string, BookmarkNode> = { ...b.nodes };
      const drop = (id: string) => {
        const node = nodes[id];
        if (node?.kind === "folder") node.children.forEach(drop);
        if (id !== roots.bar && id !== roots.other) delete nodes[id];
      };
      drop(roots.bar);
      drop(roots.other);
      for (const [id, v] of values) {
        const old = b.nodes[id];
        const key = keys.get(id)!;
        const syncKey = isBookmarkUuid(key) ? {} : { syncKey: key };
        nodes[id] =
          v.k === "u"
            ? { kind: "url", id, parentId: parentOf.get(id)!, title: v.t, url: v.u ?? "", favicon: old?.kind === "url" ? old.favicon : null, addedAt: v.a, ...syncKey }
            : { kind: "folder", id, parentId: parentOf.get(id)!, title: v.t, children: [], addedAt: v.a, ...syncKey };
      }
      for (const [parent, ids] of children) {
        const folder = nodes[parent];
        if (folder?.kind === "folder") nodes[parent] = { ...folder, children: ids.sort(byPosition) };
      }
      useBrowser.setState({ bookmarks: { ...b, nodes } });
    },
  };
}

const HISTORY_WINDOW_MS = 90 * 86_400_000;

type HistoryValue = { t: string; n: number; vt: number[] };
const lastVisitOf = (v: HistoryValue) => Math.max(0, ...v.vt);
const keptInHistory = (url: string) => /^(https?|file):/i.test(url);
const SAME_VISIT_MS = 1;

export const historyExpired = (key: string, value: unknown, now: number) =>
  key.startsWith("h:") && lastVisitOf(value as HistoryValue) < now - HISTORY_WINDOW_MS;

export function historyAdapter(profileId: string): Adapter {
  const ready = () => !!store().historyReady[profileId];
  return {
    prefix: "h:",
    extract: (base) => {
      if (!ready()) return null;
      const since = Date.now() - HISTORY_WINDOW_MS;
      const values = new Map<string, unknown>();
      const older = new Set<string>();
      const view = store().history[profileId] ?? [];
      const floor = store().historyFloor[profileId] ?? -Infinity;
      for (const e of view) {
        if (!keptInHistory(e.url)) continue;
        const key = `h:${e.url}`;
        if (e.lastVisit < since) {
          older.add(key);
          continue;
        }
        const local: HistoryValue = { t: e.title, n: e.visits, vt: e.visitTimes?.length ? e.visitTimes : [e.lastVisit] };
        const known = base(key) as HistoryValue | undefined;
        const edited = !known || local.vt.some((t) => !known.vt.some((k) => Math.abs(k - t) <= SAME_VISIT_MS));
        values.set(key, edited ? local : known);
      }
      const ignore = (key: string) => {
        if (older.has(key) || !keptInHistory(key.slice(2))) return true;
        const known = base(key) as HistoryValue | undefined;
        return !!known && (lastVisitOf(known) < since || lastVisitOf(known) <= floor);
      };
      return { values, ignore };
    },
    editedAt: (v) => lastVisitOf(v as HistoryValue),
    apply: async (visible, changed) => {
      if (!ready()) return false;
      const since = Date.now() - HISTORY_WINDOW_MS;
      const byUrl = new Map((store().history[profileId] ?? []).map((e) => [e.url, e]));
      const add: { url: string; title: string; visitTimes: number[] }[] = [];
      const remove: string[] = [];
      const updates = new Map<string, HistoryEntry | null>();
      for (const key of changed) {
        const url = key.slice(2);
        if (!keptInHistory(url)) continue;
        const v = visible.get(key) as HistoryValue | undefined;
        const old = byUrl.get(url);
        if (v) {
          const have = old?.visitTimes ?? [];
          const fresh = v.vt.filter((t) => t >= since && !have.some((h) => Math.abs(h - t) <= SAME_VISIT_MS));
          if (fresh.length) add.push({ url, title: v.t, visitTimes: fresh });
          const times = [...have, ...fresh].sort((a, z) => a - z).slice(-MAX_VISIT_TIMES);
          if (!times.length) continue;
          updates.set(url, {
            url,
            title: v.t || old?.title || "",
            favicon: null,
            visits: Math.max(v.n, old?.visits ?? 0),
            lastVisit: times[times.length - 1]!,
            visitTimes: times,
          });
        } else if (old && old.lastVisit >= since) {
          remove.push(url);
          updates.set(url, null);
        }
      }
      if (!updates.size) return;
      const engine = engineProfile(profileId);
      await Promise.all([addHistoryVisits(engine, add, SAME_VISIT_MS), deleteHistoryUrls(engine, remove)]);
      useBrowser.setState((s) => {
        const current = new Map((s.history[profileId] ?? []).map((e) => [e.url, e]));
        for (const [url, update] of updates) {
          const now = current.get(url);
          if (!update) current.delete(url);
          else if (!now) current.set(url, update);
          else {
            const times = [...new Set([...(now.visitTimes ?? []), ...(update.visitTimes ?? [])])].sort((a, z) => a - z).slice(-MAX_VISIT_TIMES);
            current.set(url, { ...update, visits: Math.max(now.visits, update.visits), lastVisit: times[times.length - 1]!, visitTimes: times });
          }
        }
        const list = [...current.values()].sort((a, z) => z.lastVisit - a.lastVisit).slice(0, MAX_HISTORY);
        return { history: { ...s.history, [profileId]: list } };
      });
    },
  };
}

export type DeviceTabs = { n: string; tabs: { u: string; t: string }[] };
const MAX_DEVICE_TABS = 30;

export function deviceTabsAdapter(profileId: string, deviceId: string, name: () => string, retired = false): Adapter {
  const key = `tabs:${deviceId}`;
  return {
    prefix: "tabs:",
    extract: () => {
      if (retired) return { values: new Map(), ignore: (k) => k !== key };
      const s = store();
      const open = Object.values(s.tabs)
        .filter((t) => t.profileId === profileId && !t.pinned && !t.unloaded && /^(https?|file):/.test(t.url) && !s.windows[t.windowId]?.incognito && !isPeekTab(s, t.id))
        .sort((a, z) => z.lastActiveAt - a.lastActiveAt)
        .slice(0, MAX_DEVICE_TABS)
        .map((t) => ({ u: t.url, t: t.customTitle || t.title }));
      return { values: new Map([[key, { n: name(), tabs: open } satisfies DeviceTabs]]), ignore: (k) => k !== key };
    },
    apply: () => true,
  };
}

type PasswordValue = { o: string; u: string; p: string };
const PASSWORD_READ_INTERVAL = 30_000;

export function passwordsAdapter(
  profileId: string,
  forced: () => boolean,
  readLogins: (engineProfile: string) => Promise<SavedLogin[] | null | undefined> = async (p) => SyncNative?.readPasswords(p),
): Adapter {
  let lastRead = 0;
  let quietUntil = 0;
  let created = new Map<string, number>();
  const profile = () => engineProfile(profileId);
  const keyOf = (origin: string, username: string) => `pw:${origin}\n${username}`;
  const read = async () => {
    const logins = await readLogins(profile());
    if (!logins) return null;
    const out = new Map<string, PasswordValue & { c: number }>();
    for (const l of logins) {
      const origin = originOf(l);
      if (origin) out.set(keyOf(origin, l.username), { o: origin, u: l.username, p: l.password, c: l.created });
    }
    return out;
  };
  return {
    prefix: "pw:",
    extract: async () => {
      const now = Date.now();
      if (now < quietUntil || (now - lastRead < PASSWORD_READ_INTERVAL && !forced())) return null;
      const logins = await read();
      if (!logins) return null;
      lastRead = now;
      created = new Map([...logins].map(([k, v]) => [k, v.c]));
      return { values: new Map([...logins].map(([k, { o, u, p }]) => [k, { o, u, p } satisfies PasswordValue])) };
    },
    editedAt: (v) => created.get(keyOf((v as PasswordValue).o, (v as PasswordValue).u)) || undefined,
    apply: async (visible, changed, base) => {
      const local = await read();
      if (!local) return false;
      let ok = true;
      for (const key of changed) {
        const v = visible.get(key) as PasswordValue | undefined;
        const have = local.get(key);
        const known = base(key) as PasswordValue | undefined;
        if (have && known?.p !== have.p) continue;
        const [origin, username] = [key.slice(3, key.indexOf("\n")), key.slice(key.indexOf("\n") + 1)];
        if (v) {
          if (have?.p === v.p) continue;
          if (have) ok = (await deletePassword(profile(), origin, username)) && ok;
          ok = (await savePassword(profile(), v.o, v.u, v.p)) && ok;
        } else if (have) {
          ok = (await deletePassword(profile(), origin, username)) && ok;
        }
      }
      let settled = false;
      for (let i = 0; i < 20 && !settled; i++) {
        const now = await read();
        settled = !!now && [...changed].every((k) => (visible.get(k) as PasswordValue | undefined)?.p === now.get(k)?.p);
        if (!settled) await new Promise((r) => setTimeout(r, 250));
      }
      if (!settled) quietUntil = Date.now() + 30_000;
      return ok;
    },
  };
}

function originOf(login: SavedLogin): string | null {
  const realm = login.origin.replace(/\/$/, "");
  return /^https?:\/\/[^/\s]+$/.test(realm) ? realm : null;
}
