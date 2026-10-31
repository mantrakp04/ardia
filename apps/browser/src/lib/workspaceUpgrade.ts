import { sessionWithLegacyShapes, sessionWithCurrentShapes } from "./sessionShapesUpgrade";
import { sessionWithOwnTabMutes } from "./sessionMuteUpgrade";
import { sessionWithSettingsMeta } from "./sessionSettingsUpgrade";
import { sessionWithPinChoiceStamps } from "./sessionPinChoicesUpgrade";
import type { SavedObject } from "./savedDocument";

const object = (value: unknown): SavedObject => value && typeof value === "object" && !Array.isArray(value) ? value as SavedObject : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const command = (value: string) => value.replace(/(switch|next|previous|new|open|moveTabTo)Profile/g, "$1Space");

function workspaceFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(workspaceFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key === "profileId" ? "spaceId" : key === "originalProfileId" ? "originalSpaceId" : key,
    workspaceFields(item),
  ]));
}

export function sessionWithSpaces(doc: SavedObject, sync?: SavedObject): SavedObject {
  doc = sessionWithPinChoiceStamps(sessionWithSettingsMeta(doc));
  if (doc.settingsMeta) doc = { ...doc, settingsMeta: Object.fromEntries(Object.entries(object(doc.settingsMeta)).map(([key, value]) => [key, list(value).map((value) => text(value).replace("defaultProfileId", "defaultSpaceId").replace("profilesFollowAppearance", "spacesFollowAppearance").replace("profileSwitcherIcons", "spaceSwitcherIcons").replace("warnBeforeMovingTabsToProfile", "warnBeforeMovingTabsToSpace").replace("cleanUpInactiveTabsAfterHours", "cleanUpInactiveTabsAfterMinutes"))])) };
  if (doc.spaces && doc.profiles) return { ...sessionWithCurrentShapes(doc.version === 4 ? sessionWithOwnTabMutes(doc) : doc) as SavedObject, version: 10 };
  doc = sessionWithLegacyShapes(doc) as SavedObject;
  if (Number(doc.version ?? 0) < 4) doc = sessionWithOwnTabMutes(doc);
  const legacy = object(doc.profiles);
  if (!Object.keys(legacy).length) throw new Error("The saved session has no browsing profiles. The original session was kept.");
  const order = [...new Set([...list(doc.profileOrder).map((id) => text(id)).filter((id) => legacy[id]), ...Object.keys(legacy)])];
  const spaces: Record<string, SavedObject> = {};
  const profiles: Record<string, SavedObject> = {};
  for (const id of order) {
    const saved = object(legacy[id]);
    const profileId = text(saved.dataId, id);
    spaces[id] = { ...saved, id, profileId };
    delete spaces[id]!.dataId;
    const owner = object(legacy[profileId] ?? saved);
    profiles[profileId] ??= { id: profileId, name: text(owner.name, "Profile"), icon: owner.icon ?? null, engineId: profileId === "default" ? "" : profileId, createdAt: owner.createdAt ?? 0 };
  }
  const oldSettings = object(doc.settings);
  const settings: SavedObject = { ...oldSettings, defaultSpaceId: spaces[text(oldSettings.defaultProfileId)] ? oldSettings.defaultProfileId : order[0] };
  delete settings.defaultProfileId;
  for (const [old, next] of [["profilesFollowAppearance", "spacesFollowAppearance"], ["profileSwitcherIcons", "spaceSwitcherIcons"], ["warnBeforeMovingTabsToProfile", "warnBeforeMovingTabsToSpace"]]) {
    if (oldSettings[old!] !== undefined) settings[next!] = oldSettings[old!];
    delete settings[old!];
  }
  if ("cleanUpInactiveTabsAfterHours" in settings) {
    const hours = settings.cleanUpInactiveTabsAfterHours;
    if (!("cleanUpInactiveTabsAfterMinutes" in settings)) settings.cleanUpInactiveTabsAfterMinutes = hours === null ? null : typeof hours === "number" && hours > 0 ? Math.max(1, Math.round(hours * 60)) : null;
    delete settings.cleanUpInactiveTabsAfterHours;
  }
  for (const key of ["chosen", "inferred"]) if (Array.isArray(settings[key])) settings[key] = list(settings[key]).map((value) => text(value).replace("defaultProfileId", "defaultSpaceId").replace("profilesFollowAppearance", "spacesFollowAppearance").replace("profileSwitcherIcons", "spaceSwitcherIcons").replace("warnBeforeMovingTabsToProfile", "warnBeforeMovingTabsToSpace").replace("cleanUpInactiveTabsAfterHours", "cleanUpInactiveTabsAfterMinutes"));
  settings.shortcuts = Object.fromEntries(Object.entries(object(settings.shortcuts)).map(([key, value]) => [command(key), value]));
  const migrated = workspaceFields(doc) as SavedObject;
  const tabs = list(migrated.tabs).map(object);
  const windows = list(migrated.windows).map(object);
  const windowRank = (tab: SavedObject) => windows.findIndex((w) => w.id === tab.windowId);
  const focused = (tab: SavedObject) => tab.windowId === (doc.focusedWindowId ?? doc.lastWindowId);
  const families = new Map<string, SavedObject[]>();
  const parkedPins = object(migrated.parkedPins);
  const parkedTopApps: Record<string, SavedObject[]> = {};
  const closedTabs = [...list(migrated.closedTabs)];
  const parked = new WeakMap<SavedObject, SavedObject>();
  const byId = new Map(tabs.map((tab) => [text(tab.id), tab]));
  const windowOrder = [doc.focusedWindowId, ...list(doc.windowOrder), ...windows.map((w) => w.id)];
  const ordered = [...new Set(windowOrder)].flatMap((id) => list(windows.find((w) => w.id === id)?.tabIds).flatMap((key) => byId.has(text(key)) ? [byId.get(text(key))!] : []));
  const candidates = [...new Set([...ordered, ...tabs])];
  for (const spaceId of order) {
    const park = object(parkedPins[spaceId]);
    const cached = list(park.tabs).map(object).filter((tab) => !tab.groupId && !tab.pinnedAsRow).map((tab) => {
      const candidate: SavedObject = { ...tab, id: `upgrade:${spaceId}:${text(tab.id)}`, pinKey: tab.id, pinned: true, spaceId, windowId: `upgrade:${spaceId}`, navigation: null, unloaded: true };
      parked.set(candidate, tab);
      return candidate;
    });
    if (cached.length) parkedPins[spaceId] = { ...park, tabs: list(park.tabs).filter((tab) => object(tab).groupId || object(tab).pinnedAsRow) };
    for (const tab of [...candidates.filter((tab) => tab.spaceId === spaceId), ...cached]) {
      if (!tab.pinned || tab.pinnedAsRow) continue;
      const key = `${text(object(object(sync?.profiles)[spaceId]).syncId, spaceId)}::${text(tab.pinKey, text(tab.id))}`;
      tab.pinKey = key;
      families.set(key, [...(families.get(key) ?? []), tab]);
    }
  }
  const bearingPage = (tab: SavedObject) => parked.has(tab) ? !!parked.get(tab)!.restoreFrom : !tab.unloaded || !!(tab.wakeAdoptId || tab.adoptId || tab.navigation);
  const topApps: Record<string, SavedObject[]> = {};
  for (const [key, family] of families) {
    const ranked = [...family].sort((a, b) => Number(bearingPage(b)) - Number(bearingPage(a)) || Number(b.lastActiveAt ?? 0) - Number(a.lastActiveAt ?? 0) || Number(focused(b)) - Number(focused(a)) || order.indexOf(text(a.spaceId)) - order.indexOf(text(b.spaceId)) || windowRank(a) - windowRank(b) || text(a.id).localeCompare(text(b.id)));
    const winner = ranked[0]!;
    const profileId = text(spaces[text(winner.spaceId)]!.profileId);
    topApps[profileId] = [...(topApps[profileId] ?? []), { key, url: winner.pinnedUrl || winner.url || "", title: winner.title ?? "", favicon: winner.favicon ?? null, customTitle: winner.customTitle ?? null, customIcon: winner.customIcon ?? null, ...(winner.tileFolder ? { tileFolder: winner.tileFolder } : {}) }];
    if (parked.has(winner) && bearingPage(winner)) {
      const restoreFrom = text(parked.get(winner)!.restoreFrom);
      parkedTopApps[profileId] = [...(parkedTopApps[profileId] ?? []), { muted: false, zoom: 1, favicon: null, title: "", customTitle: null, customIcon: null, openerId: null, createdAt: 0, lastActiveAt: 0, ...winner, wakeAdoptId: `restore:${restoreFrom}`, navigation: null, unloaded: true }];
    } else if (bearingPage(winner) && !winner.wakeAdoptId) winner.wakeAdoptId = `restore:${text(winner.id)}`;
    for (const other of ranked.slice(1)) {
      if (!bearingPage(other)) continue;
      if (parked.has(other)) {
        const restoreFrom = text(parked.get(other)!.restoreFrom);
        if (restoreFrom === text(winner.id) || restoreFrom === text(parked.get(winner)?.restoreFrom)) continue;
        closedTabs.push({ kind: "tab", id: `upgrade:${key}:${restoreFrom}`, tabId: restoreFrom, tab: { ...other, pinned: false, pinnedUrl: null, pinKey: undefined, tileFolder: undefined }, windowId: text(other.windowId), index: 0, group: null, closedAt: Number(other.lastActiveAt ?? 0) });
      } else {
        other.pinned = false;
        other.pinnedUrl = null;
        other.wakeAdoptId ??= `restore:${text(other.id)}`;
        delete other.pinKey;
        delete other.tileFolder;
      }
    }
  }
  delete migrated.profileOrder;
  delete migrated.lastProfileId;
  return sessionWithCurrentShapes({ ...migrated, version: 10, profiles, spaces, spaceOrder: order, settings, tabs, topApps, parkedPins, parkedTopApps, closedTabs, lastSpaceId: doc.lastProfileId ?? null }) as SavedObject;
}

export function liveWithSpaces(doc: SavedObject): SavedObject {
  return { ...doc, version: 2, folders: Object.fromEntries(Object.entries(object(doc.folders)).map(([id, value]) => {
    const folder = { ...object(value) };
    if (folder.profileId !== undefined) { folder.spaceId = folder.profileId; delete folder.profileId; }
    return [id, folder];
  })) };
}

export function syncWithSpaces(doc: SavedObject, session: SavedObject): SavedObject {
  if (doc.v === 2) return doc;
  const old = object(doc.profiles);
  const spaces = object(session.spaces);
  const profiles: Record<string, SavedObject> = {};
  for (const id of Object.keys(object(session.profiles))) {
    const owner = object(old[id]);
    const contributors = Object.entries(spaces).filter(([, value]) => object(value).profileId === id).map(([key]) => object(old[key]));
    profiles[id] = { syncId: text(owner.syncId, `data-${id}`), enabled: owner.enabled === true && !owner.retire, ...(owner.retire ? { retire: true } : {}), topAppsEnabled: contributors.length > 0 && contributors.every((link) => link.enabled === true && !link.retire) };
  }
  return { ...doc, v: 2, profiles, spaces: old, scopes: {}, protocolReady: false, legacyPending: true };
}

export type DocumentAccess = { read(name: string): string | null; write(name: string, contents: string): void };
type Upgrade = { state: "prepared" | "complete"; documents: Record<string, { before: string; after: string }> };
const JOURNAL = "workspace-upgrade-v10.json";

function validateSession(saved: SavedObject, version = 10): void {
  if (Number(saved.version ?? 0) > 10) throw new Error("This workspace needs a newer Ardia build. Your saved data was kept.");
  if (saved.version !== version) throw new Error("This saved workspace version cannot be upgraded safely. Your saved data was kept.");
  const spaces = object(saved.spaces);
  const profiles = object(saved.profiles);
  if (!Object.keys(spaces).length || !Object.keys(profiles).length) throw new Error("The workspace has missing spaces or profiles. Your saved data was kept.");
  if (Object.values(spaces).some((space) => !profiles[text(object(space).profileId)])) throw new Error("A space has no browsing profile. Your saved data was kept.");
  if (!spaces[text(object(saved.settings).defaultSpaceId)]) throw new Error("The default space is missing. Your saved data was kept.");
  if (list(saved.tabs).some((tab) => !spaces[text(object(tab).spaceId)])) throw new Error("A saved tab has no space. Your saved data was kept.");
}

export function upgradeWorkspaceDocuments(io: DocumentAccess): void {
  for (const [name, field, latest] of [["live.json", "version", 2], ["sync.json", "v", 2]] as const) {
    const value = io.read(name);
    if (value && Number(object(JSON.parse(value))[field] ?? 0) > latest) throw new Error("This workspace needs a newer Ardia build. Your saved data was kept.");
  }
  for (const previous of [4, 5, 8, 9]) {
  const legacyRaw = io.read(`workspace-upgrade-v${previous}.json`);
  if (legacyRaw) {
    const legacy = JSON.parse(legacyRaw) as Upgrade;
    if ((legacy.state !== "prepared" && legacy.state !== "complete") || !legacy.documents || typeof legacy.documents !== "object" || !legacy.documents["session.json"]) throw new Error("The previous workspace upgrade journal is damaged. Your saved data was kept.");
    if (legacy.state === "prepared") {
      for (const [name, value] of Object.entries(legacy.documents ?? {})) {
        if (!["session.json", "live.json", "sync.json"].includes(name) || typeof value.before !== "string" || typeof value.after !== "string") throw new Error("The previous workspace upgrade journal is damaged. Your saved data was kept.");
        const current = io.read(name);
        if (current !== value.before && current !== value.after) throw new Error("The saved workspace changed during its previous upgrade. Your saved data was kept.");
        const after = object(JSON.parse(value.after));
        if (name === "session.json") validateSession(after, previous);
      }
      for (const [name, value] of Object.entries(legacy.documents)) {
        io.write(`${name}.before-spaces-v${previous}`, value.before);
        io.write(name, value.after);
      }
      io.write(`workspace-upgrade-v${previous}.json`, JSON.stringify({ ...legacy, state: "complete" }));
    }
  }
  }
  const raw = io.read(JOURNAL);
  let upgrade = raw ? JSON.parse(raw) as Upgrade : null;
  if (upgrade && (upgrade.state !== "prepared" && upgrade.state !== "complete" || !upgrade.documents || typeof upgrade.documents !== "object" || !upgrade.documents["session.json"])) throw new Error("The workspace upgrade journal is damaged. Your saved data was kept.");
  if (upgrade?.state === "complete") {
    const current = io.read("session.json");
    if (current && Number(object(JSON.parse(current)).version ?? 0) > 10) throw new Error("This workspace needs a newer Ardia build. Your saved data was kept.");
    return;
  }
  if (!upgrade) {
    const session = io.read("session.json");
    if (!session) return;
    const saved = object(JSON.parse(session));
    if (saved.version === 10) return;
    if (Number(saved.version ?? 0) > 10) throw new Error("This workspace needs a newer Ardia build. Your saved data was kept.");
    if (![2, 3, 4, 5, 6, 7, 8, 9].includes(saved.version as number)) throw new Error("This saved workspace version cannot be upgraded safely. Your saved data was kept.");
    const rawSync = io.read("sync.json");
    const migrated = sessionWithSpaces(saved, rawSync ? object(JSON.parse(rawSync)) : undefined);
    validateSession(migrated);
    const documents: Upgrade["documents"] = { "session.json": { before: session, after: JSON.stringify(migrated) } };
    const live = io.read("live.json");
    if (live) {
      const state = object(JSON.parse(live));
      if (Number(state.version ?? 0) > 2) throw new Error("The saved folders need a newer Ardia build. Your saved data was kept.");
      documents["live.json"] = { before: live, after: JSON.stringify(liveWithSpaces(state)) };
    }
    const sync = io.read("sync.json");
    if (sync) {
      const state = object(JSON.parse(sync));
      if (Number(state.v ?? 0) > 2) throw new Error("The saved sync settings need a newer Ardia build. Your saved data was kept.");
      documents["sync.json"] = { before: sync, after: JSON.stringify(syncWithSpaces(state, migrated)) };
    }
    upgrade = { state: "prepared", documents };
    io.write(JOURNAL, JSON.stringify(upgrade));
  }
  for (const [name, value] of Object.entries(upgrade.documents)) {
    if (!["session.json", "live.json", "sync.json"].includes(name) || typeof value.before !== "string" || typeof value.after !== "string") throw new Error("The workspace upgrade journal is damaged. Your saved data was kept.");
    if (name === "session.json") validateSession(object(JSON.parse(value.after)));
    else JSON.parse(value.after);
    const current = io.read(name);
    if (current !== value.before && current !== value.after) throw new Error("The saved workspace changed during its upgrade. Your saved data was kept.");
  }
  for (const [name, value] of Object.entries(upgrade.documents)) {
    io.write(`${name}.before-spaces-v10`, value.before);
    io.write(name, value.after);
  }
  io.write(JOURNAL, JSON.stringify({ ...upgrade, state: "complete" }));
}
