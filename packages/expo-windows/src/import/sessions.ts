import { ByteReader, fromBase64, Pickle } from "./bytes";
import { entries, join, type ImportHost } from "./host";
import { fromWebKit, ImportFailure, type ImportedTab, type OpenTabs, type TabGroup } from "./model";

const SIGNATURE = 0x53534e53;
const MARKER = 255;
const LARGEST_SESSION_BYTES = 64 << 20;
const GROUP_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];

const Command = {
  setTabWindow: 0,
  setTabIndexInWindow: 2,
  prunedFromBack: 5,
  updateTabNavigation: 6,
  setSelectedNavigationIndex: 7,
  setSelectedTabInIndex: 8,
  setWindowType: 9,
  prunedFromFront: 11,
  setPinnedState: 12,
  tabClosed: 16,
  windowClosed: 17,
  lastActiveTime: 21,
  pruned: 24,
  setTabGroup: 25,
  setTabGroupMetadata2: 27,
} as const;

type Navigation = { index: number; url: string; title: string };
type Tab = { windowId: number; visualIndex: number; navigations: Navigation[]; current: number; pinned: boolean; group?: string; lastActive?: number };
type Window = { selectedTab: number; type?: number };

export async function sessionFiles(host: ImportHost, profile: string): Promise<string[]> {
  const folder = join(profile, "Sessions");
  const stamped = (await entries(host, folder))
    .filter((e) => !e.dir && /^Session_\d+$/.test(e.name))
    .map((e) => ({ stamp: Number(e.name.slice("Session_".length)), path: join(folder, e.name) }))
    .sort((a, b) => b.stamp - a.stamp);
  if (stamped.length) return stamped.map((s) => s.path);
  const names = new Set((await entries(host, profile)).filter((e) => !e.dir).map((e) => e.name));
  return ["Current Session", "Last Session"].filter((n) => names.has(n)).map((n) => join(profile, n));
}

export async function latestSessionFile(host: ImportHost, profile: string): Promise<string | undefined> {
  return (await sessionFiles(host, profile))[0];
}

const tabOf = (tabs: Map<number, Tab>, id: number): Tab => {
  let tab = tabs.get(id);
  if (!tab) tabs.set(id, (tab = { windowId: 0, visualIndex: 0, navigations: [], current: 0, pinned: false }));
  return tab;
};

const windowOf = (windows: Map<number, Window>, id: number): Window => {
  let window = windows.get(id);
  if (!window) windows.set(id, (window = { selectedTab: 0 }));
  return window;
};

const closest = (tab: Tab, index: number) => {
  const i = tab.navigations.findIndex((n) => n.index >= index);
  return i < 0 ? tab.navigations.length : i;
};

function prune(tab: Tab, index: number, count: number) {
  if (tab.current >= index && tab.current < index + count) tab.current = index - 1;
  else if (tab.current >= index + count) tab.current -= count;
  const from = closest(tab, index);
  tab.navigations.splice(from, Math.max(from, closest(tab, index + count)) - from);
  for (const n of tab.navigations) if (n.index >= index) n.index -= count;
}

const groupId = (high: string, low: string) => high + low;

function apply(tabs: Map<number, Tab>, windows: Map<number, Window>, groups: Map<string, TabGroup>, id: number, payload: Uint8Array) {
  const r = new ByteReader(payload);
  switch (id) {
    case Command.setTabWindow: {
      const window = r.i32(), tab = r.i32();
      if (window !== undefined && tab !== undefined) tabOf(tabs, tab).windowId = window;
      return;
    }
    case Command.setTabIndexInWindow: {
      const tab = r.i32(), index = r.i32();
      if (tab !== undefined && index !== undefined) tabOf(tabs, tab).visualIndex = index;
      return;
    }
    case Command.prunedFromBack: {
      const tab = r.i32(), index = r.i32();
      if (tab === undefined || index === undefined) return;
      const t = tabOf(tabs, tab);
      t.navigations.splice(closest(t, index));
      return;
    }
    case Command.prunedFromFront: {
      const tab = r.i32(), count = r.i32();
      if (tab !== undefined && count !== undefined && count > 0) prune(tabOf(tabs, tab), 0, count);
      return;
    }
    case Command.pruned: {
      const tab = r.i32(), index = r.i32(), count = r.i32();
      if (tab !== undefined && index !== undefined && count !== undefined && index >= 0 && count > 0) prune(tabOf(tabs, tab), index, count);
      return;
    }
    case Command.updateTabNavigation: {
      const p = new Pickle(payload);
      const tab = p.i32(), index = p.i32(), url = p.string(), title = p.string16();
      if (tab === undefined || index === undefined || url === undefined || title === undefined) return;
      const t = tabOf(tabs, tab);
      const i = closest(t, index);
      const nav = { index, url, title };
      if (i < t.navigations.length && t.navigations[i]!.index === index) t.navigations[i] = nav;
      else t.navigations.splice(i, 0, nav);
      return;
    }
    case Command.setSelectedNavigationIndex: {
      const tab = r.i32(), index = r.i32();
      if (tab !== undefined && index !== undefined) tabOf(tabs, tab).current = index;
      return;
    }
    case Command.setSelectedTabInIndex: {
      const window = r.i32(), index = r.i32();
      if (window !== undefined && index !== undefined) windowOf(windows, window).selectedTab = index;
      return;
    }
    case Command.setWindowType: {
      const window = r.i32(), type = r.i32();
      if (window !== undefined && type !== undefined) windowOf(windows, window).type = type;
      return;
    }
    case Command.setPinnedState: {
      const tab = r.i32(), pinned = r.u8();
      if (tab !== undefined && pinned !== undefined) tabOf(tabs, tab).pinned = pinned !== 0;
      return;
    }
    case Command.tabClosed:
    case Command.windowClosed: {
      const target = r.i32();
      if (target === undefined) return;
      if (id === Command.tabClosed) tabs.delete(target);
      else windows.delete(target);
      return;
    }
    case Command.lastActiveTime: {
      const tab = r.i32();
      if (tab === undefined || !r.skip(4)) return;
      const micros = r.i64();
      if (micros !== undefined) tabOf(tabs, tab).lastActive = fromWebKit(micros);
      return;
    }
    case Command.setTabGroup: {
      const tab = r.i32();
      if (tab === undefined || !r.skip(4)) return;
      const high = r.hex64(), low = r.hex64(), present = r.u8();
      if (high === undefined || low === undefined || present === undefined) return;
      tabOf(tabs, tab).group = present !== 0 ? groupId(high, low) : undefined;
      return;
    }
    case Command.setTabGroupMetadata2: {
      const p = new Pickle(payload);
      const high = p.hex64(), low = p.hex64(), title = p.string16(), color = p.u32();
      if (high === undefined || low === undefined || title === undefined || color === undefined) return;
      const collapsed = p.bool() ?? false;
      const id = groupId(high, low);
      groups.set(id, { id, title, color: GROUP_COLORS[color] ?? "grey", collapsed });
      return;
    }
  }
}

const withoutContainerPrefix = (url: string) => {
  if (!url.startsWith("containers+")) return url;
  const colon = url.indexOf(":");
  const inner = url.slice(colon + 1);
  return colon > 0 && inner.indexOf(":") > 0 ? inner : url;
};

export function parseSession(bytes: Uint8Array): OpenTabs {
  const reader = new ByteReader(bytes);
  if (reader.u32() !== SIGNATURE) throw new ImportFailure("unreadable", "Not a Chromium session file");
  const version = reader.u32();
  if (version !== 1 && version !== 3) throw new ImportFailure("unsupported", `Unsupported session file version ${version ?? "?"}`);
  const tabs = new Map<number, Tab>();
  const windows = new Map<number, Window>();
  const groups = new Map<string, TabGroup>();
  let sawMarker = false;
  for (;;) {
    const size = reader.u16();
    if (size === undefined || size < 1) break;
    const body = reader.take(size);
    if (!body) break;
    if (body[0] === MARKER && size === 1) sawMarker = true;
    apply(tabs, windows, groups, body[0]!, body.subarray(1));
  }
  if (version === 3 && !sawMarker) throw new ImportFailure("unreadable", "This session file is incomplete");
  const out: ImportedTab[] = [];
  const used = new Set<string>();
  const windowIds = [...windows].filter(([, w]) => w.type === 0).map(([id]) => id).sort((a, b) => a - b);
  windowIds.forEach((windowId, windowIndex) => {
    const inWindow = [...tabs]
      .filter(([, t]) => t.windowId === windowId && t.navigations.length)
      .sort(([ia, a], [ib, b]) => a.visualIndex - b.visualIndex || ia - ib);
    const selected = windows.get(windowId)?.selectedTab ?? 0;
    inWindow.forEach(([, tab], position) => {
      const i = closest(tab, tab.current);
      const nav = tab.navigations[i] ?? tab.navigations[tab.navigations.length - 1]!;
      if (!nav.url) return;
      if (tab.group) used.add(tab.group);
      out.push({
        url: withoutContainerPrefix(nav.url),
        title: nav.title,
        pinned: tab.pinned,
        ...(tab.group ? { groupId: tab.group } : {}),
        windowIndex,
        active: position === selected,
        ...(tab.lastActive !== undefined ? { lastActive: tab.lastActive } : {}),
      });
    });
  });
  const groupList = [...used].sort().map((id) => groups.get(id) ?? { id, title: "", color: "grey", collapsed: false });
  return { tabs: out, groups: groupList };
}

export async function loadSession(host: ImportHost, profile: string): Promise<OpenTabs> {
  const files = await sessionFiles(host, profile);
  if (!files.length) throw new ImportFailure("notFound", "No session file in this profile");
  let first: unknown;
  for (const file of files) {
    try {
      const base64 = await host.readBase64(file, LARGEST_SESSION_BYTES);
      if (base64 == null) throw new ImportFailure("unreadable", "The session file could not be read");
      return parseSession(fromBase64(base64));
    } catch (error) {
      first ??= error;
    }
  }
  throw first;
}
