import { addHistoryVisits, deleteHistoryUrls, deletePassword, savePassword } from "@ardia/ardiacore";
import { assignPositions, canonical, SyncNative, type Adapter, type Extraction, type SavedLogin } from "@ardia/sync";
import { bookmarkUuidFor, ensureRoots, isBookmarkUuid } from "../store/bookmarks";
import { MAX_HISTORY, MAX_VISIT_TIMES } from "../store/history";
import { useBrowser, type BrowserState } from "../store/browser";
import { ancestorIds, depthOf, leaveGroups, orderSections, syncGroupOrder, withParent } from "../store/groups";
import { engineProfile, makeTab, newId, pinnedFirst, without } from "../store/model";
import { groupChoiceKey, orderChoiceKey, placeChoiceKey, type PinSyncEntry } from "../store/organize";
import { adoptParkedPins, parkWindowPins } from "../store/parkedPins";
import { isPeekTab } from "../store/peek";
import { arrangeParked, arrangePinnedArea, parkedAnchors, parkedAreaKeys, pinnedAnchors, pinnedAreaKeys } from "../store/pinnedArea";
import { fromSync } from "../store/pinOrderChoices";
import { pinKeyOf } from "../store/pinMirror";
import { removeTabs } from "../store/tabs";
import { DEFAULT_PROFILE_ID, DEFAULT_SETTINGS, type Settings } from "../store/settings";
import { sanitizeTheme } from "../lib/profileTheme";
import { tileFolderOf, withTileFolder } from "../store/tileFolders";
import type { BookmarkNode, HistoryEntry, Profile, ProfileTheme, Tab, TabGroup, TileFolder } from "../store/types";

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
  "balancedTopApps",
  "newTabPosition",
  "newTabOpens",
  "warnBeforeClosingLastTab",
  "undoReopensClosedTab",
  "warnBeforeMovingTabsToProfile",
  "tabReorderHaptics",
  "extendWebsiteColor",
  "cmdClickCreatesTabGroup",
  "optShiftClickOpensInGroup",
  "peekModifier",
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

export type ProfileRecord = { n: string; c: Profile["color"]; i: string | null; d?: true; th?: ProfileTheme | null };

export type ProfileThemeRecord = { t: ProfileTheme } | { preset: true };

export function themeFromRecord(record: unknown): Pick<Profile, "theme"> | null {
  if (!record || typeof record !== "object") return null;
  if ("preset" in record && record.preset === true) return { theme: null };
  const theme = "t" in record ? sanitizeTheme(record.t) : null;
  return theme ? { theme } : null;
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
    extract: (base) => {
      const values = new Map<string, unknown>();
      for (const [id, { syncId, themeAdopting }] of linked()) {
        const theme = store().profiles[id]!.theme;
        const key = `pth:${syncId}`;
        if (theme === undefined || themeAdopting || unapplied(key, base)) continue;
        values.set(key, (theme ? { t: theme } : { preset: true }) satisfies ProfileThemeRecord);
      }
      const mine = new Set(values.keys());
      return { values, ignore: (key) => !mine.has(key) };
    },
    apply: (visible, changed) => {
      for (const [id, { syncId }] of linked()) {
        if (!changed.has(`pth:${syncId}`)) continue;
        const patch = themeFromRecord(visible.get(`pth:${syncId}`));
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

type PinValue = { g: string | null; u: string; t: string | null; i: string | null; ti: string; pos: string };
type PinGroupValue = { n: string; i: string | null; c: TabGroup["color"]; pos: string };
type NestGroupValue = { n: string; i: string | null; c: TabGroup["color"]; p: string };
type NestTabValue = { g: string };
const PIN_NEST = "pinn:";

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
    prefix: "pin",
    extract: (base, queued, now) => {
      const s = store();
      type Pin = Pick<Tab, "id" | "url" | "title" | "customTitle" | "customIcon"> & Partial<Pick<Tab, "pinnedUrl" | "pinnedAsRow">>;
      type Node = { pin: Pin } | { group: string };
      const area: Node[] = [];
      const inside = new Map<string, Node[]>();
      const info = new Map<string, Pick<TabGroup, "name" | "icon" | "color"> & { parent: string | null }>();
      const enter = (chain: (Pick<TabGroup, "name" | "icon" | "color"> & { key: string })[]) =>
        chain.forEach((g, i) => {
          if (info.has(g.key)) return;
          const parent = chain[i - 1]?.key ?? null;
          info.set(g.key, { name: g.name, icon: g.icon, color: g.color, parent });
          inside.set(g.key, []);
          (parent ? inside.get(parent)! : area).push({ group: g.key });
        });
      const pinned = Object.values(s.groups).filter((g) => g.pinned && g.profileId === profileId);
      const pinnedGroupOf = new Map<string, TabGroup>();
      for (const g of pinned.map((g) => [g, depthOf(s.groups, g.id)] as const).sort((a, z) => a[1] - z[1]).map(([g]) => g)) g.tabIds.forEach((id) => pinnedGroupOf.set(id, g));
      const seen = new Set<string>();
      const home = homeWindow(s, profileId);
      for (const w of home ? [home, ...openWindows(s).filter((w) => w.id !== home.id)] : openWindows(s)) {
        for (const id of w.tabIds) {
          const t = s.tabs[id];
          if (!t || t.profileId !== profileId || seen.has(pinKeyOf(t))) continue;
          const g = pinnedGroupOf.get(id);
          if (t.pinned) area.push({ pin: { ...t, id: pinKeyOf(t) } });
          else if (g) {
            const chain = [...ancestorIds(s.groups, g.id).reverse().map((x) => s.groups[x]!).filter((x) => x.pinned), g];
            enter(chain.map((x) => ({ ...x, key: pinKeyOf(x) })));
            inside.get(pinKeyOf(g))!.push({ pin: { ...t, id: pinKeyOf(t) } });
          } else continue;
          seen.add(pinKeyOf(t));
        }
      }
      const park = s.parkedPins[profileId];
      const parkGroups = new Map((park?.groups ?? []).map((g) => [g.id, g]));
      const parkChain = (key: string) => {
        const chain: (Pick<TabGroup, "name" | "icon" | "color"> & { key: string })[] = [];
        for (let g = parkGroups.get(key); g && !chain.some((c) => c.key === g!.id); g = g.parentId ? parkGroups.get(g.parentId) : undefined) chain.unshift({ ...g, key: g.id });
        return chain;
      };
      for (const p of park?.tabs ?? []) {
        if (!p.groupId) area.push({ pin: p });
        else if (parkGroups.has(p.groupId)) (enter(parkChain(p.groupId)), inside.get(p.groupId)!.push({ pin: p }));
      }
      for (const g of park?.groups ?? []) enter(parkChain(g.id));
      const values = new Map<string, unknown>();
      const chosen = s.pinChoices[profileId] ?? {};
      const sync = s.pinSync[profileId] ?? {};
      const baseTab = (key: string) => base(`pin:t:${key}`) as PinValue | undefined;
      const baseGroup = (key: string) => base(`pin:g:${key}`) as PinGroupValue | undefined;
      const pinValue = (t: Pin, group: string | null, pos: string): PinValue => {
        const was = baseTab(t.id);
        const entry = was ? sync[t.id] : undefined;
        const waiting = !group && !!was?.g && entry?.g === was.g && now < (entry.w ?? 0);
        return {
          g: waiting ? was!.g : group,
          u: (group ? t.url : t.pinnedUrl || t.url) || "",
          t: t.customTitle,
          i: t.customIcon,
          ti: t.title,
          pos: waiting ? was!.pos : pos,
        };
      };
      const flat = (key: string): { pin: Pin; inner: string }[] => inside.get(key)!.flatMap((n) => ("pin" in n ? [{ pin: n.pin, inner: key }] : flat(n.group)));
      const nest = (key: string) => {
        for (const n of inside.get(key)!) {
          if (!("group" in n)) continue;
          const g = info.get(n.group)!;
          values.set(`${PIN_NEST}g:${n.group}`, { n: g.name, i: g.icon, c: g.color, p: key } satisfies NestGroupValue);
          nest(n.group);
        }
      };
      const legacyRank = (n: Node) => ("pin" in n ? (n.pin.pinnedAsRow ? 1 : 0) : 2);
      area.sort((a, z) => legacyRank(a) - legacyRank(z));
      const areaPositions = assignPositions(area.map((n) => ("pin" in n ? ((baseTab(n.pin.id)?.g ?? null) === null ? baseTab(n.pin.id)?.pos : undefined) : baseGroup(n.group)?.pos)));
      area.forEach((n, i) => {
        if ("pin" in n) {
          values.set(`pin:t:${n.pin.id}`, pinValue(n.pin, null, areaPositions[i]!));
          return;
        }
        const g = info.get(n.group)!;
        values.set(`pin:g:${n.group}`, { n: g.name, i: g.icon, c: g.color, pos: areaPositions[i]! } satisfies PinGroupValue);
        const members = flat(n.group);
        const positions = assignPositions(members.map(({ pin }) => (baseTab(pin.id)?.g === n.group ? baseTab(pin.id)?.pos : undefined)));
        members.forEach(({ pin, inner }, j) => {
          values.set(`pin:t:${pin.id}`, pinValue(pin, n.group, positions[j]!));
          if (inner !== n.group) values.set(`${PIN_NEST}t:${pin.id}`, { g: inner } satisfies NestTabValue);
        });
        nest(n.group);
      });
      const choiceOf = (k: string) => (k.startsWith("pin:g:") ? groupChoiceKey(k.slice(6)) : placeChoiceKey(k.slice(6)));
      return {
        values,
        ignore: (k) => k.startsWith(PIN_ROW),
        republish: (k) => k.startsWith("pin:") && choiceOf(k) in chosen && !queued(k),
        published: (keys) =>
          settleChoices(profileId, Object.fromEntries([...keys].filter((k) => k.startsWith("pin:")).map(choiceOf).filter((c) => c in chosen).map((c) => [c, chosen[c]!]))),
      } satisfies Extraction;
    },
    apply: (visible, changed, base, records) => {
      if ([...changed].every((k) => k.startsWith(PIN_ROW))) return true;
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
      const nestValues = new Map<string, NestGroupValue>();
      const awaiting = new Map<string, string>();
      const hadGroup = new Set([...Object.values(s.groups).filter((g) => g.profileId === profileId).map(pinKeyOf), ...(s.parkedPins[profileId]?.groups ?? []).map((g) => g.id)]);
      const expired = (k: string, g: string) => sync[k.slice(6)]?.g === g && (sync[k.slice(6)]!.w ?? 0) <= records.now;
      const listed = (g: string) => visible.has(`pin:g:${g}`) || visible.has(`${PIN_NEST}g:${g}`);
      const unresolved = (k: string, g: string) => !listed(g) && !hadGroup.has(g) && !records.known(`pin:g:${g}`) && !expired(k, g);
      const contained = (id: string) => !!s.tabs[id] && (s.tabs[id]!.pinned || pinnedMember.has(id));
      const retainedIn = (id: string, g: string) =>
        !contained(id) && Object.values(s.groups).some((x) => !x.pinned && x.profileId === profileId && pinKeyOf(x) === g && x.tabIds.includes(id));
      for (const [k, v] of visible) {
        if (k.startsWith("pin:t:")) {
          const g = (v as PinValue).g;
          const id = tid(k.slice(6));
          if (g && !listed(g) && retainedIn(id, g)) continue;
          if (g && unresolved(k, g)) awaiting.set(id, g);
          pins.set(id, { ...(v as PinValue), g: g && gid(g) });
        } else if (k.startsWith("pin:g:")) groupValues.set(gid(k.slice(6)), v as PinGroupValue);
        else if (k.startsWith(`${PIN_NEST}g:`)) nestValues.set(gid(k.slice(PIN_NEST.length + 2)), v as NestGroupValue);
      }
      const all = new Set([...groupValues.keys(), ...nestValues.keys()]);
      const keyOf = (id: string) => keyOfLocal.get(id) ?? id;
      const byKey = (a: string, z: string) => (keyOf(a) < keyOf(z) ? -1 : keyOf(a) > keyOf(z) ? 1 : 0);
      const parentGroup = new Map<string, string | null>();
      for (const id of all) {
        const p = nestValues.get(id)?.p;
        const parent = p && listed(p) ? gid(p) : null;
        parentGroup.set(id, parent && parent !== id && all.has(parent) ? parent : null);
      }
      for (const start of [...all].sort(byKey)) {
        const path: string[] = [];
        for (let at: string | null = start; at; at = parentGroup.get(at) ?? null) {
          const loop = path.indexOf(at);
          if (loop >= 0) {
            parentGroup.set(path.slice(loop).sort(byKey)[0]!, null);
            break;
          }
          path.push(at);
        }
      }
      const chainUp = (id: string) => {
        const out: string[] = [];
        for (let g: string | null = id; g && !out.includes(g); g = parentGroup.get(g) ?? null) out.push(g);
        return out;
      };
      const lookOf = (id: string): Pick<PinGroupValue, "n" | "i" | "c"> => (parentGroup.get(id) ? (nestValues.get(id) ?? groupValues.get(id)) : (groupValues.get(id) ?? nestValues.get(id)))!;
      for (const [k, v] of visible) {
        if (!k.startsWith(`${PIN_NEST}t:`)) continue;
        const key = k.slice(PIN_NEST.length + 2);
        const inner = (v as NestTabValue).g;
        if (!visible.has(`pin:t:${key}`) || !listed(inner)) continue;
        const id = tid(key);
        const pin = pins.get(id);
        if (pin?.g && all.has(pin.g) && all.has(gid(inner)) && chainUp(gid(inner)).at(-1) === chainUp(pin.g).at(-1)) pins.set(id, { ...pin, g: gid(inner) });
      }
      for (const [id, v] of pins) if (v.g && !all.has(v.g)) pins.set(id, { ...v, g: null });
      type Slot = { id: string; group: boolean; pos: string };
      const bySlot = (a: Slot, z: Slot) => (a.pos < z.pos ? -1 : a.pos > z.pos ? 1 : a.id < z.id ? -1 : 1);
      const roots = [...all].filter((id) => !parentGroup.get(id));
      const areaSlots = [
        ...[...pins].filter(([, v]) => !v.g).map(([id, v]) => ({ id, group: false, pos: v.pos })),
        ...roots.map((id) => ({ id, group: true, pos: groupValues.get(id)?.pos ?? `\uffff${keyOf(id)}` })),
      ].sort(bySlot);
      const kids = new Map<string, Slot[]>();
      const placedGroups = new Set<string>();
      const members = [...pins].filter(([, v]) => v.g).map(([id, v]) => ({ id, group: false, pos: v.pos, chain: chainUp(v.g!).reverse() }));
      for (const m of members.sort(bySlot)) {
        m.chain.forEach((g, i) => {
          if (i === 0 || placedGroups.has(g)) return;
          placedGroups.add(g);
          kids.set(m.chain[i - 1]!, [...(kids.get(m.chain[i - 1]!) ?? []), { id: g, group: true, pos: "" }]);
        });
        kids.set(m.chain.at(-1)!, [...(kids.get(m.chain.at(-1)!) ?? []), m]);
      }
      const walk = (id: string): Slot[] => (kids.get(id) ?? []).flatMap((x) => (x.group ? [x, ...walk(x.id)] : [x]));
      const tree = areaSlots.flatMap((x) => (x.group ? [x, ...walk(x.id)] : [x]));
      const groupOrder = tree.filter((x) => x.group).map((x) => x.id);
      const tileOrder = areaSlots.filter((x) => !x.group).map((x) => x.id);
      const memberOrder = new Map([...all].map((g) => [g, walk(g).filter((x) => !x.group).map((x) => x.id)]));

      const goneTabs = [...changed].filter((k) => k.startsWith("pin:t:") && !visible.has(k)).map((k) => tid(k.slice(6))).filter((id) => contained(id) && scope.has(s.tabs[id]!.windowId));
      const removable = goneTabs.filter((id) => {
        const t = s.tabs[id]!;
        const w = s.windows[t.windowId];
        const kept = !!t.navigation || !!t.adoptId || Object.values(w?.activeTabIds ?? {}).includes(id);
        return w && !kept && w.tabIds.some((other) => other !== id && !goneTabs.includes(other));
      });
      s = removeTabs(s, removable, false);
      const tabs = { ...s.tabs };
      for (const id of goneTabs) if (tabs[id]) tabs[id] = { ...tabs[id]!, pinned: false, pinnedUrl: null, pinnedAsRow: undefined, tileFolder: undefined, pinKey: undefined };
      let groups = { ...s.groups };
      for (const k of changed) {
        const key = k.startsWith("pin:g:") ? k.slice(6) : k.startsWith(`${PIN_NEST}g:`) ? k.slice(PIN_NEST.length + 2) : null;
        if (key === null || visible.has(k) || all.has(gid(key))) continue;
        if (groups[gid(key)]?.pinned && scope.has(groups[gid(key)]!.windowId)) delete groups[gid(key)];
      }
      const windows = { ...s.windows };

      for (const id of groupOrder) {
        const v = lookOf(id);
        const old = groups[id];
        const made: TabGroup = old
          ? { ...old, name: v.n, icon: v.i, color: v.c, pinned: true }
          : { id, ...pinKeyField(id), windowId: newPinWindow, profileId, name: v.n, icon: v.i, color: v.c, collapsed: false, pinned: true, tabIds: [], createdAt: Date.now() };
        groups[id] = withParent(made, parentGroup.get(id) ?? undefined);
      }
      const noted = new Map<string, PinSyncEntry>();
      const note = (key: string, id: string) => {
        const g = awaiting.get(id);
        const was = sync[key];
        if ((was?.g ?? undefined) === g) return;
        noted.set(key, g ? { g, w: was?.g === g && was.w !== undefined ? was.w : records.now + records.horizon } : {});
      };
      for (const [id, v] of pins) {
        const group = v.g && all.has(v.g) && groups[v.g] ? groups[v.g]! : null;
        const old = tabs[id];
        if (old) {
          tabs[id] = {
            ...old,
            pinned: !group,
            pinnedUrl: group ? null : v.u,
            ...(group ? { pinnedAsRow: undefined } : old.pinned ? {} : { pinnedAsRow: marked(pinKeyOf(old)) }),
            ...(group ? { tileFolder: undefined } : old.pinned || marked(pinKeyOf(old)) ? {} : folderMark(base, pinKeyOf(old))),
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
          ...(!group && !marked(keyOfLocal.get(id) ?? id) ? folderMark(base, keyOfLocal.get(id) ?? id) : {}),
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
      const pinnedHere = Object.values(groups).filter((g) => g.profileId === profileId && g.pinned);
      for (const { id: groupId } of pinnedHere.map((g) => [g, depthOf(groups, g.id)] as const).sort((a, z) => a[1] - z[1]).map(([g]) => g)) {
        const g = groups[groupId]!;
        const parent = g.parentId ? groups[g.parentId] : undefined;
        const real = (w: string) => w !== PARK && !!windows[w];
        const homes = g.tabIds.map((id) => tabs[copied.get(id) ?? id]!).filter((t) => real(t.windowId));
        const windowId = parent ? parent.windowId : !homes.length || homes.some((t) => t.windowId === g.windowId) ? g.windowId : (homes.find(hasPage) ?? homes[0]!).windowId;
        const tabIds: string[] = [];
        for (const id of g.tabIds.map((x) => copied.get(x) ?? x)) {
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

      const sequence = tree.filter((x) => !x.group).map((x) => copied.get(x.id) ?? x.id);
      const rank = new Map(sequence.map((id, i) => [id, i]));
      for (const w of Object.values(windows)) {
        if (w.incognito) continue;
        const ids = w.tabIds.filter((id) => tabs[id]);
        const slots = ids.map((id, i) => (rank.has(id) ? i : -1)).filter((i) => i >= 0);
        const sorted = slots.map((i) => ids[i]!).sort((a, z) => rank.get(a)! - rank.get(z)!);
        slots.forEach((slot, i) => (ids[slot] = sorted[i]!));
        const sectioned = { ...w, tabIds: orderSections(pinnedFirst(ids, tabs, groups), tabs, groups) };
        const window = { ...sectioned, tabIds: arrangePinnedArea({ tabs, groups }, sectioned, profileId, (group) => anchorIn(base(`${PIN_ORDER}${group}`))) };
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
      fromSync(() => useBrowser.setState({ tabs, windows, groups, live, find, splits, selection, windowOrder, windowUi, parkedPins, pinSync }));
    },
  };
}

const PIN_ORDER = "pord:g:";
type PinOrderValue = { a: string | null };
const anchorIn = (value: unknown) => (value as PinOrderValue | undefined)?.a;

export function pinnedOrderAdapter(profileId: string): Adapter {
  const shownIn = (s: BrowserState) => openWindows(s).filter((w) => w.tabIds.some((id) => s.tabs[id]?.profileId === profileId));
  return {
    prefix: PIN_ORDER,
    extract: (base, queued, _now, _known, remote, stamp) => {
      const s = store();
      const home = homeWindow(s, profileId);
      const shown = !!home && shownIn(s).includes(home);
      const gone = (key: string) => remote(key) === null;
      const ignore = (k: string) => !gone(`pin:g:${k.slice(PIN_ORDER.length)}`);
      if (!shown && !s.parkedPins[profileId]) return { values: new Map(), ignore } satisfies Extraction;
      const anchors = shown ? pinnedAnchors(s, home!, profileId) : parkedAnchors(s, profileId);
      const chosen = s.pinChoices[profileId] ?? {};
      const choiceOf = (k: string) => orderChoiceKey(k.slice(PIN_ORDER.length));
      const rows = new Set((shown ? pinnedAreaKeys(s, home!, profileId) : parkedAreaKeys(s, profileId)).filter((k) => k.startsWith("t:")).map((k) => k.slice(2)));
      const values = new Map<string, unknown>();
      for (const [group, a] of anchors) {
        const was = base(`${PIN_ORDER}${group}`) as PinOrderValue | undefined;
        const since = stamp(`${PIN_ORDER}${group}`);
        const changedSince = (key: string) => since !== undefined && (stamp(key) ?? "") > since;
        const pin = was?.a ? (remote(`pin:t:${was.a}`) as PinValue | null | undefined) : undefined;
        const leftRows = !!was?.a && changedSince(`pin:t:${was.a}`) && (pin === null || (!!pin && pin.g !== null));
        const madeTile = !!was?.a && changedSince(`${PIN_ROW}${was.a}`) && remote(`${PIN_ROW}${was.a}`) !== ROW;
        const settled = leftRows || madeTile;
        const waiting = !(orderChoiceKey(group) in chosen) && !!was?.a && was.a !== a && !rows.has(was.a) && !settled;
        values.set(`${PIN_ORDER}${group}`, waiting ? was! : ({ a } satisfies PinOrderValue));
      }
      return {
        values,
        ignore,
        republish: (k) => choiceOf(k) in chosen && !queued(k),
        published: (published) => settleChoices(profileId, Object.fromEntries([...published].map(choiceOf).filter((c) => c in chosen).map((c) => [c, chosen[c]!]))),
      } satisfies Extraction;
    },
    apply: (visible) => {
      const s = store();
      const anchorOf = (group: string) => anchorIn(visible.get(`${PIN_ORDER}${group}`));
      let windows = s.windows;
      let groups = s.groups;
      for (const w of shownIn(s)) {
        const tabIds = arrangePinnedArea(s, w, profileId, anchorOf);
        if (tabIds === w.tabIds) continue;
        const window = { ...w, tabIds };
        windows = { ...windows, [w.id]: window };
        groups = syncGroupOrder(groups, window);
      }
      const park = s.parkedPins[profileId];
      const parked = park && arrangeParked(park, anchorOf);
      if (windows === s.windows && parked === park) return true;
      fromSync(() => useBrowser.setState({ windows, groups, ...(park && parked !== park ? { parkedPins: { ...s.parkedPins, [profileId]: parked! } } : {}) }));
      return true;
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
      const stillMarked = new Set([...visible.keys()].map(keyOf));
      const touched = new Set([...changed].map(keyOf).filter((key) => stillMarked.has(key)));
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
        const sectioned = { ...w, tabIds: orderSections(pinnedFirst(ids, tabs, s.groups), tabs, s.groups) };
        windows[w.id] = { ...sectioned, tabIds: arrangePinnedArea({ tabs, groups: s.groups }, sectioned, profileId, (group) => anchorIn(base(`${PIN_ORDER}${group}`))) };
        edited = true;
      }
      const park = s.parkedPins[profileId];
      const marked = park?.tabs.map((p) =>
        p.groupId || !wants(p.id, p.pinnedAsRow) ? p : rows.has(p.id) ? { ...p, pinnedAsRow: true as const } : (({ pinnedAsRow: _, ...rest }) => rest)(p),
      );
      const parked = park && marked && arrangeParked({ ...park, tabs: marked }, (group) => anchorIn(base(`${PIN_ORDER}${group}`))).tabs;
      const parkEdited = !!park && parked!.some((p, i) => p !== park.tabs[i]);
      if (!edited && !parkEdited) return true;
      fromSync(() =>
        useBrowser.setState({
          tabs,
          windows,
          ...(parkEdited ? { parkedPins: { ...s.parkedPins, [profileId]: { ...park!, tabs: parked! } } } : {}),
        }),
      );
      return true;
    },
  };
}

const TILE_FOLDER = "tilefold:";
const FOLDER_NAME = `${TILE_FOLDER}n:`;
type TileFolderValue = { f: string };
type FolderNameValue = { n: string };

const syncedFolderId = (value: unknown) => {
  const v = value as TileFolderValue | undefined;
  return v && typeof v.f === "string" ? v.f : undefined;
};
const syncedName = (value: unknown) => {
  const v = value as FolderNameValue | undefined;
  return v && typeof v.n === "string" ? v.n : undefined;
};
const folderMark = (base: (key: string) => unknown, key: string) => {
  const id = syncedFolderId(base(`${TILE_FOLDER}${key}`));
  return id ? { tileFolder: { id, name: syncedName(base(`${FOLDER_NAME}${id}`)) ?? "" } } : {};
};
const localFolders = new Map<string, Set<string>>();

export function tileFoldersAdapter(profileId: string): Adapter {
  const keyOf = (k: string) => k.slice(TILE_FOLDER.length);
  return {
    prefix: TILE_FOLDER,
    extract: (base, _queued, _now, recorded, remote) => {
      const s = store();
      const values = new Map<string, unknown>();
      const known = new Set<string>();
      const local = new Map<string, TileFolder>();
      const mark = (key: string, folder: TileFolder | undefined) => {
        known.add(key);
        if (!folder) return;
        values.set(`${TILE_FOLDER}${key}`, { f: folder.id } satisfies TileFolderValue);
        const was = local.get(folder.id);
        if (!was || (folder.renamedAt ?? -1) > (was.renamedAt ?? -1)) local.set(folder.id, folder);
      };
      const unpinned = (key: string) => recorded(`pin:t:${key}`) && remote(`pin:t:${key}`) === null;
      const home = homeWindow(s, profileId);
      for (const w of home ? [home, ...openWindows(s).filter((w) => w.id !== home.id)] : openWindows(s)) {
        for (const id of w.tabIds) {
          const t = s.tabs[id];
          if (t?.pinned && t.profileId === profileId && !known.has(pinKeyOf(t))) mark(pinKeyOf(t), tileFolderOf(t));
        }
      }
      for (const p of s.parkedPins[profileId]?.tabs ?? []) if (!p.groupId && !known.has(p.id)) mark(p.id, p.pinnedAsRow ? undefined : p.tileFolder);
      for (const [folderId, folder] of local) {
        const synced = base(`${FOLDER_NAME}${folderId}`);
        if (folder.renamedAt !== undefined && syncedName(synced) !== folder.name) values.set(`${FOLDER_NAME}${folderId}`, { n: folder.name } satisfies FolderNameValue);
        else if (synced !== undefined) values.set(`${FOLDER_NAME}${folderId}`, synced);
      }
      const had = localFolders.get(profileId) ?? new Set();
      localFolders.set(profileId, new Set(local.keys()));
      const ignore = (k: string) => {
        if (k.startsWith(FOLDER_NAME)) return !had.has(k.slice(FOLDER_NAME.length));
        return !known.has(keyOf(k)) && base(`pin:t:${keyOf(k)}`) === undefined && !unpinned(keyOf(k));
      };
      return { values, ignore } satisfies Extraction;
    },
    apply: (visible, changed) => {
      const s = store();
      const touched = new Set([...changed].filter((k) => !k.startsWith(FOLDER_NAME)).map(keyOf));
      const names = new Map<string, string>();
      for (const [k, v] of visible) {
        const name = k.startsWith(FOLDER_NAME) ? syncedName(v) : undefined;
        if (name !== undefined) names.set(k.slice(FOLDER_NAME.length), name);
      }
      const wanted = (key: string, current: TileFolder | undefined): TileFolder | undefined => {
        const id = touched.has(key) ? syncedFolderId(visible.get(`${TILE_FOLDER}${key}`)) : current?.id;
        if (!id) return undefined;
        const name = names.get(id);
        if (current?.id === id && (name === undefined || name === current.name)) return current;
        return { id, name: name ?? (current?.id === id ? current.name : "") };
      };
      let tabs: Record<string, Tab> | null = null;
      for (const w of openWindows(s)) {
        for (const id of w.tabIds) {
          const t = s.tabs[id];
          if (!t?.pinned || t.pinnedAsRow || t.profileId !== profileId) continue;
          const folder = wanted(pinKeyOf(t), t.tileFolder);
          if (folder !== t.tileFolder) (tabs ??= { ...s.tabs })[id] = withTileFolder(t, folder);
        }
      }
      const park = s.parkedPins[profileId];
      const parked = park?.tabs.map((p) => {
        if (p.groupId || p.pinnedAsRow) return p;
        const folder = wanted(p.id, p.tileFolder);
        if (folder === p.tileFolder) return p;
        const { tileFolder: _, ...rest } = p;
        return folder ? { ...rest, tileFolder: folder } : rest;
      });
      const parkEdited = !!park && parked!.some((p, i) => p !== park.tabs[i]);
      if (!tabs && !parkEdited) return true;
      fromSync(() =>
        useBrowser.setState({
          ...(tabs ? { tabs } : {}),
          ...(parkEdited ? { parkedPins: { ...s.parkedPins, [profileId]: { ...park!, tabs: parked! } } } : {}),
        }),
      );
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
