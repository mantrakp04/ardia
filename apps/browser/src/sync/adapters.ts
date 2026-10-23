import { addHistoryVisits, deleteHistoryUrls, deletePassword, savePassword } from "@ardia/ardiacore";
import { assignPositions, canonical, SyncNative, type Adapter, type Extraction, type SavedLogin } from "@ardia/sync";
import { bookmarkUuidFor, ensureRoots, isBookmarkUuid } from "../store/bookmarks";
import { MAX_HISTORY, MAX_VISIT_TIMES } from "../store/history";
import { useBrowser, type BrowserState } from "../store/browser";
import { leaveGroups, orderSections, syncGroupOrder } from "../store/groups";
import { engineProfile, makeTab, newId, pinnedFirst, without } from "../store/model";
import { groupChoiceKey, placeChoiceKey, type PinSyncEntry } from "../store/organize";
import { adoptParkedPins, parkWindowPins } from "../store/parkedPins";
import { pinKeyOf } from "../store/pinMirror";
import { removeTabs } from "../store/tabs";
import { DEFAULT_PROFILE_ID, DEFAULT_SETTINGS, type Settings } from "../store/settings";
import { sanitizeTheme } from "../lib/profileTheme";
import type { BookmarkNode, HistoryEntry, Profile, ProfileTheme, Tab, TabGroup } from "../store/types";

const store = () => useBrowser.getState();

export const SYNCED_SETTINGS = [
  "warnBeforeQuitting",
  "warnBeforeClosingWindow",
  "searchEngine",
  "customSearchUrl",
  "customSearchEngines",
  "searchSuggestions",
  "commandBarPreference",
  "tabLayout",
  "hideToolbarWhileScrolling",
  "showSidebarButton",
  "newTabPosition",
  "newTabOpens",
  "warnBeforeClosingLastTab",
  "warnBeforeMovingTabsToProfile",
  "tabReorderHaptics",
  "extendWebsiteColor",
  "cmdClickCreatesTabGroup",
  "optShiftClickOpensInGroup",
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
        .filter((t) => t.profileId === profileId && !t.pinned && !t.unloaded && /^(https?|file):/.test(t.url) && !s.windows[t.windowId]?.incognito)
        .sort((a, z) => z.lastActiveAt - a.lastActiveAt)
        .slice(0, MAX_DEVICE_TABS)
        .map((t) => ({ u: t.url, t: t.customTitle || t.title }));
      return { values: new Map([[key, { n: name(), tabs: open } satisfies DeviceTabs]]), ignore: (k) => k !== key };
    },
    apply: () => true,
  };
}

type PinValue = { g: string | null; u: string; t: string | null; i: string | null; ti: string; pos: string };
type PinGroupValue = { n: string; i: string | null; c: TabGroup["color"]; pos: string };

type Window = BrowserState["windows"][string];

const hasPage = (t: Tab) => !!t.navigation || !!t.adoptId;

const openWindows = (s: BrowserState) => s.windowOrder.map((id) => s.windows[id]).filter((w): w is Window => !!w && !w.incognito && w.kind !== "small");

function homeWindow(s: BrowserState, profileId: string): Window | undefined {
  const order = [...s.ui.focusOrder, ...s.windowOrder].map((id) => s.windows[id]).filter((w): w is Window => !!w && !w.incognito && w.kind !== "small");
  const shows = (w: Window) => w.tabIds.some((id) => s.tabs[id]?.profileId === profileId);
  return order.find((w) => w.profileId === profileId && shows(w)) ?? order.find(shows) ?? order.find((w) => w.profileId === profileId) ?? order[0];
}


export function pinnedAdapter(profileId: string): Adapter {
  return {
    prefix: "pin:",
    extract: (base, queued, now) => {
      const s = store();
      type Pin = Pick<Tab, "id" | "url" | "title" | "customTitle" | "customIcon"> & Partial<Pick<Tab, "pinnedUrl">>;
      const tiles: Pin[] = [];
      const groups: Pick<TabGroup, "id" | "name" | "icon" | "color">[] = [];
      const members = new Map<string, Pin[]>();
      const pinnedGroupOf = new Map<string, TabGroup>();
      for (const g of Object.values(s.groups)) if (g.pinned && g.profileId === profileId) g.tabIds.forEach((id) => pinnedGroupOf.set(id, g));
      const seen = new Set<string>();
      const home = homeWindow(s, profileId);
      for (const w of home ? [home, ...openWindows(s).filter((w) => w.id !== home.id)] : openWindows(s)) {
        for (const id of w.tabIds) {
          const t = s.tabs[id];
          if (!t || t.profileId !== profileId || seen.has(pinKeyOf(t))) continue;
          const g = pinnedGroupOf.get(id);
          if (t.pinned) tiles.push({ ...t, id: pinKeyOf(t) });
          else if (g) {
            const key = pinKeyOf(g);
            if (!members.has(key)) {
              members.set(key, []);
              groups.push({ ...g, id: key });
            }
            members.get(key)!.push({ ...t, id: pinKeyOf(t) });
          } else continue;
          seen.add(pinKeyOf(t));
        }
      }
      const park = s.parkedPins[profileId];
      for (const g of park?.groups ?? []) if (!members.has(g.id)) (members.set(g.id, []), groups.push(g));
      for (const p of park?.tabs ?? []) (p.groupId ? members.get(p.groupId) : tiles)?.push(p);
      const values = new Map<string, unknown>();
      const chosen = s.pinChoices[profileId] ?? {};
      const sync = s.pinSync[profileId] ?? {};
      const place = (tabs: Pin[], group: string | null) => {
        const positions = assignPositions(tabs.map((t) => ((base(`pin:t:${t.id}`) as PinValue | undefined)?.g ?? null) === group ? (base(`pin:t:${t.id}`) as PinValue | undefined)?.pos : undefined));
        tabs.forEach((t, i) => {
          const was = base(`pin:t:${t.id}`) as PinValue | undefined;
          const entry = was ? sync[t.id] : undefined;
          const waiting = !group && !!was?.g && entry?.g === was.g && now < (entry.w ?? 0);
          values.set(`pin:t:${t.id}`, {
            g: waiting ? was!.g : group,
            u: (group ? t.url : t.pinnedUrl || t.url) || "",
            t: t.customTitle,
            i: t.customIcon,
            ti: t.title,
            pos: waiting ? was!.pos : positions[i]!,
          } satisfies PinValue);
        });
      };
      place(tiles, null);
      const groupPositions = assignPositions(groups.map((g) => (base(`pin:g:${g.id}`) as PinGroupValue | undefined)?.pos));
      groups.forEach((g, i) => {
        values.set(`pin:g:${g.id}`, { n: g.name, i: g.icon, c: g.color, pos: groupPositions[i]! } satisfies PinGroupValue);
        place(members.get(g.id)!, g.id);
      });
      const choiceOf = (k: string) => (k.startsWith("pin:g:") ? groupChoiceKey(k.slice(6)) : placeChoiceKey(k.slice(6)));
      return {
        values,
        republish: (k) => choiceOf(k) in chosen && !queued(k),
        published: (keys) => settleChoices(profileId, Object.fromEntries([...keys].map(choiceOf).filter((c) => c in chosen).map((c) => [c, chosen[c]!]))),
      } satisfies Extraction;
    },
    apply: (visible, changed, base, records) => {
      const sync = store().pinSync[profileId] ?? {};
      let s = store();
      const home = homeWindow(s, profileId);
      if (!home) return false;
      const marked = (key: string) => (base(`${PIN_ROW}${key}`) === ROW ? (true as const) : undefined);
      const PARK = `park:${profileId}`;
      const shown = home.tabIds.some((id) => s.tabs[id]?.profileId === profileId);
      if (s.parkedPins[profileId] || !shown) {
        const stand: Window = { id: PARK, profileId, incognito: false, tabIds: [], activeTabIds: {}, sidebarOpen: true, frame: null, createdAt: 0 };
        s = { ...s, windows: { ...s.windows, [PARK]: stand } };
        if (s.parkedPins[profileId]) s = adoptParkedPins(s, PARK, profileId);
      }
      const newPinWindow = shown ? home.id : PARK;
      const scope = new Set([home.id, PARK]);
      const tabOfKey = new Map<string, string>();
      const groupOfKey = new Map<string, string>();
      const pinnedMember = new Set(Object.values(s.groups).filter((g) => g.pinned && g.profileId === profileId).flatMap((g) => g.tabIds));
      const searchOrder = [...scope, ...Object.keys(s.windows).filter((w) => !scope.has(w))];
      const kept = new Map<string, Tab>();
      for (const wid of searchOrder) {
        for (const id of s.windows[wid]?.tabIds ?? []) {
          const t = s.tabs[id];
          if (t?.profileId !== profileId) continue;
          if (t.pinned || pinnedMember.has(id)) {
            if (!tabOfKey.has(pinKeyOf(t))) tabOfKey.set(pinKeyOf(t), id);
          } else if (t.pinKey) {
            const other = kept.get(t.pinKey);
            if (!other || (!hasPage(other) && hasPage(t))) kept.set(t.pinKey, t);
          }
        }
      }
      for (const [key, t] of kept) if (!tabOfKey.has(key)) tabOfKey.set(key, t.id);
      for (const g of Object.values(s.groups)) if (g.pinned && g.profileId === profileId && scope.has(g.windowId) && !groupOfKey.has(pinKeyOf(g))) groupOfKey.set(pinKeyOf(g), g.id);
      const keyOfLocal = new Map<string, string>();
      const local = (ofKey: Map<string, string>, taken: (id: string) => boolean, key: string) => {
        const known = ofKey.get(key);
        if (known) return known;
        const id = taken(key) ? newId("tab") : key;
        ofKey.set(key, id);
        if (id !== key) keyOfLocal.set(id, key);
        return id;
      };
      const tid = (key: string) => local(tabOfKey, (id) => !!s.tabs[id] && s.tabs[id]!.profileId !== profileId, key);
      const gid = (key: string) => local(groupOfKey, (id) => !!s.groups[id] && (s.groups[id]!.profileId !== profileId || !s.groups[id]!.pinned), key);
      const pinKeyField = (id: string) => (keyOfLocal.has(id) ? { pinKey: keyOfLocal.get(id)! } : {});
      const pins = new Map<string, PinValue>();
      const groupValues = new Map<string, PinGroupValue>();
      const awaiting = new Map<string, string>();
      const hadGroup = new Set([...Object.values(s.groups).filter((g) => g.profileId === profileId).map(pinKeyOf), ...(s.parkedPins[profileId]?.groups ?? []).map((g) => g.id)]);
      const expired = (k: string, g: string) => sync[k.slice(6)]?.g === g && (sync[k.slice(6)]!.w ?? 0) <= records.now;
      const unresolved = (k: string, g: string) => !visible.has(`pin:g:${g}`) && !hadGroup.has(g) && !records.known(`pin:g:${g}`) && !expired(k, g);
      const contained = (id: string) => !!s.tabs[id] && (s.tabs[id]!.pinned || pinnedMember.has(id));
      const retainedIn = (id: string, g: string) =>
        !contained(id) && Object.values(s.groups).some((x) => !x.pinned && x.profileId === profileId && pinKeyOf(x) === g && x.tabIds.includes(id));
      for (const [k, v] of visible) {
        if (k.startsWith("pin:t:")) {
          const g = (v as PinValue).g;
          const id = tid(k.slice(6));
          if (g && !visible.has(`pin:g:${g}`) && retainedIn(id, g)) continue;
          if (g && unresolved(k, g)) awaiting.set(id, g);
          pins.set(id, { ...(v as PinValue), g: g && gid(g) });
        } else if (k.startsWith("pin:g:")) groupValues.set(gid(k.slice(6)), v as PinGroupValue);
      }
      const byPos = <T extends { pos: string }>(m: Map<string, T>) => (a: string, z: string) =>
        m.get(a)!.pos < m.get(z)!.pos ? -1 : m.get(a)!.pos > m.get(z)!.pos ? 1 : a < z ? -1 : 1;
      const groupOrder = [...groupValues.keys()].sort(byPos(groupValues));
      const tileOrder = [...pins.keys()].filter((id) => { const g = pins.get(id)!.g; return !g || !groupValues.has(g); }).sort(byPos(pins));
      const memberOrder = new Map(groupOrder.map((g) => [g, [...pins.keys()].filter((id) => pins.get(id)!.g === g).sort(byPos(pins))]));

      const goneTabs = [...changed].filter((k) => k.startsWith("pin:t:") && !visible.has(k)).map((k) => tid(k.slice(6))).filter((id) => contained(id) && scope.has(s.tabs[id]!.windowId));
      const removable = goneTabs.filter((id) => {
        const t = s.tabs[id]!;
        const w = s.windows[t.windowId];
        const kept = !!t.navigation || !!t.adoptId || Object.values(w?.activeTabIds ?? {}).includes(id);
        return w && !kept && w.tabIds.some((other) => other !== id && !goneTabs.includes(other));
      });
      s = removeTabs(s, removable, false);
      const tabs = { ...s.tabs };
      for (const id of goneTabs) if (tabs[id]) tabs[id] = { ...tabs[id]!, pinned: false, pinnedUrl: null, pinnedAsRow: undefined, pinKey: undefined };
      let groups = { ...s.groups };
      for (const k of changed) if (k.startsWith("pin:g:") && !visible.has(k) && groups[gid(k.slice(6))]?.pinned && scope.has(groups[gid(k.slice(6))]!.windowId)) delete groups[gid(k.slice(6))];
      const windows = { ...s.windows };

      for (const id of groupOrder) {
        const v = groupValues.get(id)!;
        const old = groups[id];
        groups[id] = old
          ? { ...old, name: v.n, icon: v.i, color: v.c, pinned: true }
          : { id, ...pinKeyField(id), windowId: newPinWindow, profileId, name: v.n, icon: v.i, color: v.c, collapsed: false, pinned: true, tabIds: [], createdAt: Date.now() };
      }
      const noted = new Map<string, PinSyncEntry>();
      const note = (key: string, id: string) => {
        const g = awaiting.get(id);
        const was = sync[key];
        if ((was?.g ?? undefined) === g) return;
        noted.set(key, g ? { g, w: was?.g === g && was.w !== undefined ? was.w : records.now + records.horizon } : {});
      };
      for (const [id, v] of pins) {
        const group = v.g && groupValues.has(v.g) && groups[v.g] ? groups[v.g]! : null;
        const old = tabs[id];
        if (old) {
          tabs[id] = {
            ...old,
            pinned: !group,
            pinnedUrl: group ? null : v.u,
            ...(group ? { pinnedAsRow: undefined } : old.pinned ? {} : { pinnedAsRow: marked(pinKeyOf(old)) }),
            customTitle: v.t,
            customIcon: v.i,
            ...(old.unloaded ? { url: v.u, title: v.ti } : {}),
          };
          note(pinKeyOf(tabs[id]!), id);
          continue;
        }
        const windowId = group?.windowId ?? newPinWindow;
        const w = windows[windowId];
        if (!w) continue;
        const tab: Tab = {
          ...makeTab(windowId, profileId, v.u, { title: v.ti, pinned: !group, customTitle: v.t, customIcon: v.i }),
          id,
          ...pinKeyField(id),
          pinnedUrl: group ? null : v.u,
          ...(!group && marked(keyOfLocal.get(id) ?? id) ? { pinnedAsRow: true as const } : {}),
          navigation: null,
          unloaded: true,
        };
        note(keyOfLocal.get(id) ?? id, id);
        tabs[id] = tab;
        windows[windowId] = { ...w, tabIds: [...w.tabIds, id] };
      }
      const standalone = new Set(tileOrder.filter((id) => tabs[id]?.pinned));
      groups = {
        ...Object.fromEntries(Object.entries(groups).filter(([, g]) => g.pinned)),
        ...leaveGroups(Object.fromEntries(Object.entries(groups).filter(([, g]) => !g.pinned)), standalone),
      };
      const inGroup = new Set([...memberOrder.values()].flat().filter((id) => tabs[id]));
      for (const g of Object.values(groups)) {
        if (g.profileId !== profileId) continue;
        const wanted = g.pinned && memberOrder.has(g.id) ? memberOrder.get(g.id)!.filter((id) => tabs[id]) : g.tabIds.filter((id) => !inGroup.has(id));
        groups[g.id] = { ...g, tabIds: wanted };
      }
      for (const g of Object.values(groups)) if (g.profileId === profileId && !g.tabIds.length) delete groups[g.id];
      const copied = new Map<string, string>();
      for (const g of Object.values(groups)) {
        if (g.profileId !== profileId || !g.pinned) continue;
        const real = (w: string) => w !== PARK && !!windows[w];
        const homes = g.tabIds.map((id) => tabs[id]!).filter((t) => real(t.windowId));
        const windowId = !homes.length || homes.some((t) => t.windowId === g.windowId) ? g.windowId : (homes.find(hasPage) ?? homes[0]!).windowId;
        const tabIds: string[] = [];
        for (const id of g.tabIds) {
          const t = tabs[id]!;
          if (t.windowId === windowId) tabIds.push(id);
          else if (t.windowId === PARK && windows[windowId]) {
            windows[PARK] = { ...windows[PARK]!, tabIds: windows[PARK]!.tabIds.filter((x) => x !== id) };
            windows[windowId] = { ...windows[windowId]!, tabIds: [...windows[windowId]!.tabIds, id] };
            tabs[id] = { ...t, windowId };
            tabIds.push(id);
          } else if (windows[windowId]) {
            const copy: Tab = {
              ...makeTab(windowId, profileId, t.url, { title: t.title, favicon: t.favicon, customTitle: t.customTitle, customIcon: t.customIcon }),
              pinKey: pinKeyOf(t),
              navigation: null,
              unloaded: true,
            };
            tabs[copy.id] = copy;
            tabs[id] = { ...t, pinKey: undefined };
            windows[windowId] = { ...windows[windowId]!, tabIds: [...windows[windowId]!.tabIds, copy.id] };
            tabIds.push(copy.id);
            copied.set(id, copy.id);
          }
        }
        groups[g.id] = { ...g, windowId, tabIds };
      }

      const sequence = [...tileOrder, ...groupOrder.flatMap((g) => memberOrder.get(g) ?? [])].map((id) => copied.get(id) ?? id);
      const rank = new Map(sequence.map((id, i) => [id, i]));
      for (const w of Object.values(windows)) {
        if (w.incognito) continue;
        const ids = w.tabIds.filter((id) => tabs[id]);
        const slots = ids.map((id, i) => (rank.has(id) ? i : -1)).filter((i) => i >= 0);
        const sorted = slots.map((i) => ids[i]!).sort((a, z) => rank.get(a)! - rank.get(z)!);
        slots.forEach((slot, i) => (ids[slot] = sorted[i]!));
        const window = { ...w, tabIds: orderSections(pinnedFirst(ids, tabs), tabs, groups) };
        windows[w.id] = window;
        groups = syncGroupOrder(groups, window);
      }
      let { live, parkedPins } = s;
      const parkWindow = windows[PARK];
      if (parkWindow) {
        parkedPins = parkWindowPins(parkedPins, parkWindow, { tabs, groups, history: s.history });
        for (const id of parkWindow.tabIds) delete tabs[id];
        live = without(live, parkWindow.tabIds);
        groups = Object.fromEntries(Object.entries(groups).filter(([, g]) => g.windowId !== PARK));
        delete windows[PARK];
      }
      const { find, splits, selection, windowOrder, windowUi } = s;
      const pinSync = noted.size ? { ...s.pinSync, [profileId]: { ...s.pinSync[profileId], ...Object.fromEntries(noted) } } : s.pinSync;
      useBrowser.setState({ tabs, windows, groups, live, find, splits, selection, windowOrder, windowUi, parkedPins, pinSync });
    },
  };
}

const PIN_ROW = "pinrow:";
const ROW = 1;
const TILE = 0;

function settleChoices(profileId: string, published: Record<string, number>) {
  const now = store().pinChoices;
  const mine = now[profileId];
  if (!mine) return;
  const left = Object.fromEntries(Object.entries(mine).filter(([key, n]) => published[key] !== n));
  if (Object.keys(left).length === Object.keys(mine).length) return;
  const { [profileId]: _, ...others } = now;
  useBrowser.setState({ pinChoices: Object.keys(left).length ? { ...now, [profileId]: left } : others });
}

export function pinnedRowsAdapter(profileId: string): Adapter {
  const keyOf = (k: string) => k.slice(PIN_ROW.length);
  return {
    prefix: PIN_ROW,
    extract: (base, queued) => {
      const s = store();
      const values = new Map<string, unknown>();
      const known = new Set<string>();
      const chosen = s.pinChoices[profileId] ?? {};
      const home = homeWindow(s, profileId);
      const mark = (key: string, row: boolean | undefined) => {
        if (row) values.set(`${PIN_ROW}${key}`, ROW);
        else if (key in chosen || base(`${PIN_ROW}${key}`) !== undefined) values.set(`${PIN_ROW}${key}`, TILE);
      };
      const windows = home ? [home, ...openWindows(s).filter((w) => w.id !== home.id)] : openWindows(s);
      for (const w of windows) {
        for (const id of w.tabIds) {
          const t = s.tabs[id];
          if (!t?.pinned || t.profileId !== profileId || known.has(pinKeyOf(t))) continue;
          known.add(pinKeyOf(t));
          mark(pinKeyOf(t), t.pinnedAsRow);
        }
      }
      for (const p of s.parkedPins[profileId]?.tabs ?? []) {
        if (p.groupId || known.has(p.id)) continue;
        known.add(p.id);
        mark(p.id, p.pinnedAsRow);
      }
      return {
        values,
        ignore: (k) => !known.has(keyOf(k)) && base(`pin:t:${keyOf(k)}`) === undefined,
        republish: (k) => keyOf(k) in chosen && !queued(k),
        published: (keys) => settleChoices(profileId, Object.fromEntries([...keys].map(keyOf).filter((k) => k in chosen).map((k) => [k, chosen[k]!]))),
      } satisfies Extraction;
    },
    apply: (visible, changed, base) => {
      const s = store();
      const rows = new Set([...visible].filter(([, v]) => v === ROW).map(([k]) => keyOf(k)));
      const pos = (t: Tab | undefined) => (t ? (base(`pin:t:${pinKeyOf(t)}`) as PinValue | undefined)?.pos : undefined);
      const touched = new Set([...changed].map(keyOf));
      const wants = (key: string, row: boolean | undefined) => touched.has(key) && !!row !== rows.has(key);
      const tabs = { ...s.tabs };
      const windows = { ...s.windows };
      let edited = false;
      for (const w of openWindows(s)) {
        let moved = false;
        for (const id of w.tabIds) {
          const t = tabs[id];
          if (!t?.pinned || t.profileId !== profileId || !wants(pinKeyOf(t), t.pinnedAsRow)) continue;
          tabs[id] = rows.has(pinKeyOf(t)) ? { ...t, pinnedAsRow: true } : { ...t, pinnedAsRow: undefined };
          moved = true;
        }
        if (!moved) continue;
        const ids = [...w.tabIds];
        const slots = ids.map((id, i) => (tabs[id]?.pinned && tabs[id]!.profileId === profileId && pos(tabs[id]) !== undefined ? i : -1)).filter((i) => i >= 0);
        const sorted = slots.map((i) => ids[i]!).sort((a, z) => (pos(tabs[a])! < pos(tabs[z])! ? -1 : pos(tabs[a])! > pos(tabs[z])! ? 1 : 0));
        slots.forEach((slot, i) => (ids[slot] = sorted[i]!));
        windows[w.id] = { ...w, tabIds: orderSections(pinnedFirst(ids, tabs), tabs, s.groups) };
        edited = true;
      }
      const park = s.parkedPins[profileId];
      const parked = park?.tabs.map((p) =>
        p.groupId || !wants(p.id, p.pinnedAsRow) ? p : rows.has(p.id) ? { ...p, pinnedAsRow: true as const } : (({ pinnedAsRow: _, ...rest }) => rest)(p),
      );
      const parkEdited = !!park && parked!.some((p, i) => p !== park.tabs[i]);
      if (!edited && !parkEdited) return true;
      useBrowser.setState({
        tabs,
        windows,
        ...(parkEdited ? { parkedPins: { ...s.parkedPins, [profileId]: { ...park!, tabs: parked! } } } : {}),
      });
      return true;
    },
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
