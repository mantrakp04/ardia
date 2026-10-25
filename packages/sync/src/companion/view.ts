import { visible, type ScopeState } from "../scope.ts";
import { fromLegacy } from "./legacy.ts";
import { lastVisitOf, type BookmarkValue, type DeviceTabsValue, type DeviceValue, type HistoryValue } from "./adapters.ts";

export const MAX_HISTORY_ITEMS = 2_000;

type Kind = "mac" | "phone";
type ProfileRecord = { n?: unknown; c?: unknown; i?: unknown; d?: unknown; th?: unknown };

export type ViewDevice = { id: string; name: string; kind: Kind; lastSeen: number | null; isCurrent: boolean; canReceiveTabs: boolean };
export type ViewTheme = { colors: string[]; darkColors: string[] | null };
export type ViewDeviceTabs = { deviceId: string; deviceName: string; kind: Kind; tabs: { url: string; title: string }[] };
export type ViewPinnedTab = { key: string; title: string; url: string; icon: string | null };
export type ViewPinnedTile = ViewPinnedTab & { folder: ViewPinnedTab[] | null };
export type ViewPinnedSection = { tab: ViewPinnedTab } | { group: ViewPinnedGroup };
export type ViewPinnedGroup = { key: string; name: string; icon: string | null; color: string | null; items: ViewPinnedSection[] };
export type ViewBookmark = { key: string; title: string; url: string | null; added: number; root: "bar" | "other" | null; children: ViewBookmark[] | null };
export type ViewHistory = { url: string; title: string; visits: number; lastVisit: number };
export type ViewProfile = {
  syncId: string;
  name: string;
  color: string | null;
  icon: string | null;
  isDefault: boolean;
  theme: ViewTheme | null;
  deviceTabs: ViewDeviceTabs[];
  pinned: { tiles: ViewPinnedTile[]; sections: ViewPinnedSection[] };
  bookmarks: ViewBookmark[];
  history: ViewHistory[];
};
export type ViewSearch = { engineId: string; customURL: string | null; customEngines: { id: string; name: string; keyword: string; url: string }[] };
export type View = { devices: ViewDevice[]; profiles: ViewProfile[]; search: ViewSearch | null };

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const optStr = (v: unknown) => (typeof v === "string" && v ? v : null);
const kindOf = (v: unknown): Kind => (v === "phone" ? "phone" : "mac");
const byPosThenKey = <T extends { pos: string; key: string }>(a: T, z: T) => (a.pos < z.pos ? -1 : a.pos > z.pos ? 1 : a.key < z.key ? -1 : a.key > z.key ? 1 : 0);

export function liveProfiles(app: ScopeState | undefined): Map<string, ProfileRecord> {
  const out = new Map<string, ProfileRecord>();
  if (!app) return out;
  for (const [k, v] of visible(app, "prof:")) if (v && typeof v === "object") out.set(k.slice(5), v as ProfileRecord);
  return out;
}

export function defaultProfileId(profiles: Map<string, ProfileRecord>): string | null {
  const ids = [...profiles.keys()].sort();
  return ids.find((id) => profiles.get(id)!.d === true) ?? ids[0] ?? null;
}

export function dataOwner(app: ScopeState | undefined, syncId: string): string {
  if (!app) return syncId;
  const profiles = liveProfiles(app);
  const path = [syncId];
  for (let at = syncId; ; ) {
    const owner = (app.records[`share:${at}`]?.v as { o?: unknown } | null | undefined)?.o;
    if (typeof owner !== "string" || owner === at || !profiles.has(owner)) return at;
    const loop = path.indexOf(owner);
    if (loop >= 0) return path.slice(loop).sort()[0]!;
    path.push(owner);
    at = owner;
  }
}

function hex(n: unknown) {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
  return Math.round(v * 255).toString(16).padStart(2, "0").toUpperCase();
}

function colorsOf(look: unknown): string[] | null {
  if (!look || typeof look !== "object" || !Array.isArray((look as { stops?: unknown }).stops)) return null;
  const out: string[] = [];
  for (const stop of (look as { stops: unknown[] }).stops.slice(0, 16)) {
    if (out.length >= 3) break;
    const c = (stop as { color?: Record<string, unknown> } | null)?.color;
    if (!c || ![c.r, c.g, c.b].every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 4)) continue;
    const alpha = typeof c.a === "number" && Number.isFinite(c.a) ? Math.min(1, Math.max(0, c.a)) : 1;
    out.push(`#${hex(c.r)}${hex(c.g)}${hex(c.b)}${alpha < 1 ? hex(alpha) : ""}`);
  }
  return out.length ? out : null;
}

function themeOf(app: ScopeState, syncId: string, profile: ProfileRecord): ViewTheme | null {
  const record = app.records[`pth:${syncId}`]?.v as Record<string, unknown> | null | undefined;
  const theme = record ? (record.preset === true ? null : record.t) : profile.th;
  const colors = colorsOf(theme);
  if (!colors) return null;
  return { colors, darkColors: colorsOf((theme as { dark?: unknown }).dark) };
}

function deviceTabs(scope: ScopeState | undefined, me: string, devices: Map<string, ViewDevice>): ViewDeviceTabs[] {
  if (!scope) return [];
  const out: ViewDeviceTabs[] = [];
  for (const [k, v] of visible(scope, "tabs:")) {
    const deviceId = k.slice(5);
    const device = devices.get(deviceId);
    const value = v as DeviceTabsValue;
    if (deviceId === me || !device || !Array.isArray(value?.tabs)) continue;
    const seen = new Set<string>();
    const tabs: { url: string; title: string }[] = [];
    for (const t of value.tabs) {
      const url = fromLegacy(str(t?.u));
      const title = str(t?.t);
      if (!url || seen.has(`${url}\n${title}`)) continue;
      seen.add(`${url}\n${title}`);
      tabs.push({ url, title });
    }
    if (!tabs.length) continue;
    out.push({ deviceId, deviceName: device.name || str(value.n) || "Unknown Device", kind: value.k ? kindOf(value.k) : device.kind, tabs });
  }
  return out.sort((a, z) => (devices.get(z.deviceId)!.lastSeen ?? 0) - (devices.get(a.deviceId)!.lastSeen ?? 0) || (a.deviceId < z.deviceId ? -1 : 1));
}

type PinValue = { g?: unknown; u?: unknown; t?: unknown; i?: unknown; ti?: unknown; pos?: unknown };
type GroupLook = { n?: unknown; i?: unknown; c?: unknown; pos?: unknown; p?: unknown };

export function pinnedArea(scope: ScopeState | undefined): ViewProfile["pinned"] {
  if (!scope) return { tiles: [], sections: [] };
  const records = (prefix: string) => visible(scope, prefix);
  const pins = new Map<string, PinValue>();
  for (const [k, v] of records("pin:t:")) if (v && typeof v === "object") pins.set(k.slice(6), fromLegacy(v as PinValue));
  const groupValues = new Map<string, GroupLook>();
  for (const [k, v] of records("pin:g:")) if (v && typeof v === "object") groupValues.set(k.slice(6), v as GroupLook);
  const nestValues = new Map<string, GroupLook>();
  for (const [k, v] of records("pinn:g:")) if (v && typeof v === "object") nestValues.set(k.slice(7), v as GroupLook);
  const rows = new Set([...records("pinrow:")].filter(([, v]) => v === 1).map(([k]) => k.slice(7)));
  const order = records("pord:g:");
  const all = new Set([...groupValues.keys(), ...nestValues.keys()]);
  const parent = new Map<string, string | null>();
  for (const id of all) {
    const p = nestValues.get(id)?.p;
    parent.set(id, typeof p === "string" && p !== id && all.has(p) ? p : null);
  }
  for (const start of [...all].sort()) {
    const path: string[] = [];
    for (let at: string | null = start; at; at = parent.get(at) ?? null) {
      const loop = path.indexOf(at);
      if (loop >= 0) {
        parent.set(path.slice(loop).sort()[0]!, null);
        break;
      }
      path.push(at);
    }
  }
  const chainUp = (id: string) => {
    const out: string[] = [];
    for (let g: string | null = id; g && !out.includes(g); g = parent.get(g) ?? null) out.push(g);
    return out;
  };
  const groupOf = new Map<string, string | null>();
  for (const [key, v] of pins) groupOf.set(key, typeof v.g === "string" && all.has(v.g) ? v.g : null);
  for (const [k, v] of records("pinn:t:")) {
    const key = k.slice(7);
    const inner = (v as { g?: unknown })?.g;
    const g = groupOf.get(key);
    if (!g || typeof inner !== "string" || !all.has(inner)) continue;
    if (chainUp(inner).at(-1) === chainUp(g).at(-1)) groupOf.set(key, inner);
  }
  const tabOf = (key: string): ViewPinnedTab => {
    const v = pins.get(key)!;
    return { key, title: optStr(v.t) ?? str(v.ti), url: str(v.u), icon: optStr(v.i) };
  };
  const pos = (v: { pos?: unknown } | undefined, key: string) => (typeof v?.pos === "string" ? v.pos : `￿${key}`);
  const standalone = [...pins.keys()].filter((k) => groupOf.get(k) === null).map((key) => ({ key, pos: pos(pins.get(key), key) }));
  const roots = [...all].filter((id) => !parent.get(id)).map((key) => ({ key, pos: pos(groupValues.get(key), key) }));
  const areaSlots = [...standalone.map((s) => ({ ...s, group: false })), ...roots.map((r) => ({ ...r, group: true }))].sort(byPosThenKey);

  const kids = new Map<string, ({ group: true; key: string } | { group: false; key: string })[]>();
  const placed = new Set<string>();
  const members = [...pins.keys()]
    .filter((k) => groupOf.get(k))
    .map((key) => ({ key, pos: pos(pins.get(key), key), chain: chainUp(groupOf.get(key)!).reverse() }))
    .sort(byPosThenKey);
  for (const m of members) {
    m.chain.forEach((g, i) => {
      if (i === 0 || placed.has(g)) return;
      placed.add(g);
      kids.set(m.chain[i - 1]!, [...(kids.get(m.chain[i - 1]!) ?? []), { group: true, key: g }]);
    });
    const leaf = m.chain.at(-1)!;
    kids.set(leaf, [...(kids.get(leaf) ?? []), { group: false, key: m.key }]);
  }
  const lookOf = (id: string): GroupLook => (parent.get(id) ? (nestValues.get(id) ?? groupValues.get(id)) : (groupValues.get(id) ?? nestValues.get(id))) ?? {};
  const groupView = (id: string): ViewPinnedGroup => {
    const look = lookOf(id);
    return {
      key: id,
      name: str(look.n),
      icon: optStr(look.i),
      color: optStr(look.c),
      items: (kids.get(id) ?? []).map((x) => (x.group ? { group: groupView(x.key) } : { tab: tabOf(x.key) })),
    };
  };

  const folderOf = new Map<string, string>();
  for (const [k, v] of records("tilefold:")) {
    if (k.startsWith("tilefold:n:")) continue;
    const f = (v as { f?: unknown })?.f;
    if (typeof f === "string" && f) folderOf.set(k.slice(9), f);
  }
  const folderName = (id: string) => str((scope.records[`tilefold:n:${id}`]?.v as { n?: unknown } | null | undefined)?.n);
  const tileKeys = areaSlots.filter((s) => !s.group && !rows.has(s.key)).map((s) => s.key);
  const folderMembers = new Map<string, string[]>();
  for (const key of tileKeys) {
    const f = folderOf.get(key);
    if (f) folderMembers.set(f, [...(folderMembers.get(f) ?? []), key]);
  }
  const tiles: ViewPinnedTile[] = [];
  const emitted = new Set<string>();
  for (const key of tileKeys) {
    const f = folderOf.get(key);
    const inFolder = f ? folderMembers.get(f)! : [];
    if (!f || inFolder.length < 2) {
      tiles.push({ ...tabOf(key), folder: null });
      continue;
    }
    if (emitted.has(f)) continue;
    emitted.add(f);
    const tabs = inFolder.map(tabOf);
    tiles.push({ key: `tilefold:${f}`, title: folderName(f) || "Folder", url: tabs[0]!.url, icon: null, folder: tabs });
  }

  const blocks = areaSlots.filter((s) => (s.group ? !!kids.get(s.key)?.length : rows.has(s.key)));
  const rowKeys = new Set(blocks.filter((b) => !b.group).map((b) => b.key));
  const anchorOf = (group: string) => {
    const v = order.get(`pord:g:${group}`) as { a?: unknown } | undefined;
    if (v === undefined) return undefined;
    return typeof v?.a === "string" ? v.a : null;
  };
  let ordered = blocks;
  if (blocks.some((b) => b.group && anchorOf(b.key) !== undefined)) {
    const placedAfter = new Map<string | null, typeof blocks>();
    const last: typeof blocks = [];
    for (const g of blocks.filter((b) => b.group)) {
      const a = anchorOf(g.key);
      if (a === null || (a !== undefined && rowKeys.has(a))) placedAfter.set(a, [...(placedAfter.get(a) ?? []), g]);
      else last.push(g);
    }
    ordered = [...(placedAfter.get(null) ?? []), ...blocks.filter((b) => !b.group).flatMap((r) => [r, ...(placedAfter.get(r.key) ?? [])]), ...last];
  }
  const sections = ordered.map((b): ViewPinnedSection => (b.group ? { group: groupView(b.key) } : { tab: tabOf(b.key) }));
  return { tiles, sections };
}

export function bookmarkTree(scope: ScopeState | undefined): ViewBookmark[] {
  if (!scope) return [];
  const values = new Map<string, BookmarkValue>();
  for (const [k, v] of visible(scope, "bm:")) {
    const b = v as BookmarkValue;
    if (b && typeof b === "object" && (b.k === "u" || b.k === "f")) values.set(k.slice(3), fromLegacy(b));
  }
  const parentOf = new Map<string, string>();
  for (const [key, v] of values) {
    const p = typeof v.p === "string" ? v.p : "other";
    parentOf.set(key, p === "bar" || p === "other" ? p : values.get(p)?.k === "f" ? p : "other");
  }
  for (const key of [...values.keys()].sort()) {
    const seen = new Set([key]);
    for (let at = parentOf.get(key)!; parentOf.has(at); at = parentOf.get(at)!) {
      if (seen.has(at)) {
        parentOf.set(key, "other");
        break;
      }
      seen.add(at);
    }
  }
  const children = new Map<string, string[]>();
  for (const key of values.keys()) children.set(parentOf.get(key)!, [...(children.get(parentOf.get(key)!) ?? []), key]);
  const sorted = (parent: string) =>
    (children.get(parent) ?? []).map((key) => ({ key, pos: str(values.get(key)!.pos) })).sort(byPosThenKey).map((x) => x.key);
  const node = (key: string, root: "bar" | "other" | null): ViewBookmark => {
    const v = values.get(key)!;
    const folder = v.k === "f";
    return {
      key,
      title: str(v.t),
      url: folder ? null : str(v.u),
      added: typeof v.a === "number" && Number.isFinite(v.a) ? v.a : 0,
      root,
      children: folder ? sorted(key).map((k) => node(k, null)) : null,
    };
  };
  return [...sorted("bar").map((k) => node(k, "bar")), ...sorted("other").map((k) => node(k, "other"))];
}

export function historyList(scope: ScopeState | undefined): ViewHistory[] {
  if (!scope) return [];
  const out: ViewHistory[] = [];
  for (const [k, v] of visible(scope, "h:")) {
    const h = v as HistoryValue;
    if (!h || typeof h !== "object" || !Array.isArray(h.vt) || !h.vt.length) continue;
    out.push({ url: fromLegacy(k.slice(2)), title: str(h.t), visits: typeof h.n === "number" ? h.n : h.vt.length, lastVisit: lastVisitOf(h) });
  }
  return out.sort((a, z) => z.lastVisit - a.lastVisit || (a.url < z.url ? -1 : 1)).slice(0, MAX_HISTORY_ITEMS);
}

function searchOf(app: ScopeState): ViewSearch | null {
  const setting = (name: string) => {
    const record = app.records[`set:${name}`]?.v as { v?: unknown } | null | undefined;
    return record && typeof record === "object" ? fromLegacy(record.v) : undefined;
  };
  const engine = setting("searchEngine");
  const customUrl = setting("customSearchUrl");
  const custom = setting("customSearchEngines");
  if (engine === undefined && customUrl === undefined && custom === undefined) return null;
  const engines = Array.isArray(custom)
    ? custom
        .filter((e) => e && typeof e === "object" && ["id", "name", "keyword", "url"].every((f) => typeof (e as Record<string, unknown>)[f] === "string"))
        .map((e) => {
          const { id, name, keyword, url } = e as Record<string, string>;
          return { id: id!, name: name!, keyword: keyword!, url: url! };
        })
    : [];
  return { engineId: typeof engine === "string" && engine ? engine : "google", customURL: optStr(customUrl), customEngines: engines };
}

export function buildView(scopes: Record<string, ScopeState>, me: string): View {
  const app = scopes.app;
  if (!app) return { devices: [], profiles: [], search: null };
  const lastSeen = new Map<string, number>();
  for (const scope of Object.values(scopes)) {
    for (const [device, at] of Object.entries(scope.seen)) lastSeen.set(device, Math.max(at, lastSeen.get(device) ?? 0));
  }
  const devices = new Map<string, ViewDevice>();
  for (const [k, v] of visible(app, "dev:")) {
    const id = k.slice(4);
    const d = v as DeviceValue;
    devices.set(id, {
      id,
      name: str(d?.n) || "Unknown Device",
      kind: kindOf(d?.k),
      lastSeen: lastSeen.get(id) ?? null,
      isCurrent: id === me,
      canReceiveTabs: Array.isArray(d?.f) && d.f.includes("send"),
    });
  }
  const deviceList = [...devices.values()].sort((a, z) => Number(z.isCurrent) - Number(a.isCurrent) || (z.lastSeen ?? 0) - (a.lastSeen ?? 0) || (a.id < z.id ? -1 : 1));
  const profiles = liveProfiles(app);
  const defaultId = defaultProfileId(profiles);
  const profileList: ViewProfile[] = [...profiles].map(([syncId, p]) => {
    const own = scopes[`p:${syncId}`];
    const data = scopes[`p:${dataOwner(app, syncId)}`];
    return {
      syncId,
      name: str(p.n) || "Profile",
      color: optStr(p.c),
      icon: optStr(p.i),
      isDefault: syncId === defaultId,
      theme: themeOf(app, syncId, p),
      deviceTabs: deviceTabs(own, me, devices),
      pinned: pinnedArea(own),
      bookmarks: bookmarkTree(data),
      history: historyList(data),
    };
  });
  profileList.sort((a, z) => Number(z.isDefault) - Number(a.isDefault) || a.name.localeCompare(z.name) || (a.syncId < z.syncId ? -1 : 1));
  return { devices: deviceList, profiles: profileList, search: searchOf(app) };
}
