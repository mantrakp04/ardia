import { readDocument, writeDocument } from "../../platform/documents";
import { create } from "zustand";
import type { CompletedItem, CompletionState, FolderStatus, LiveAccount, LiveFolder, LiveFolderKind, LiveItem, LiveSourceId } from "./types";
import { parseSaved, unchanged, versionedJson, type Migrations } from "../../lib/savedDocument";
import { DEFAULT_COUNTDOWN_LEAD, keepDismissedNow, type DismissedNow } from "./meetings";

export type LiveConfig = {
  githubClientId: string;
  bitbucketUser: string;
  confluenceSite: string;
  confluenceEmail: string;
  googleClientId: string;
};

export type CalendarSettings = {
  alertLead: string;
  alertCondition: "always" | "activeOnly";
  showPreview: boolean;
  showTimeToNext: boolean;
  countdownLead: number;
  hiddenCalendarIds: string[];
  prompted: boolean;
};

export type MeetingGroup = {
  groupId: string;
  callTabId: string;
  occurrence: string | null;
  title: string;
  start: number | null;
  end: number | null;
  endedAt: number | null;
};

type LiveState = {
  folders: Record<string, LiveFolder>;
  folderOrder: string[];
  items: Record<string, LiveItem[]>;
  known: Record<string, string[]>;
  unread: Record<string, string[]>;
  hidden: Record<string, LiveItem[]>;
  completed: Record<string, CompletedItem[]>;
  completing: Record<string, string[]>;
  status: Record<string, FolderStatus>;
  expandedStacks: Record<string, boolean>;
  showAll: Record<string, boolean>;
  accounts: Partial<Record<LiveSourceId, LiveAccount>>;
  config: LiveConfig;
  calendar: CalendarSettings;
  meetingGroups: Record<string, MeetingGroup>;
  dismissedAlerts: string[];
  dismissedNow: DismissedNow;
};

export const DEFAULT_CONFIG: LiveConfig = { githubClientId: "", bitbucketUser: "", confluenceSite: "", confluenceEmail: "", googleClientId: "" };

export const DEFAULT_CALENDAR: CalendarSettings = {
  alertLead: "1",
  alertCondition: "always",
  showPreview: true,
  showTimeToNext: true,
  countdownLead: DEFAULT_COUNTDOWN_LEAD,
  hiddenCalendarIds: [],
  prompted: false,
};

const DOC = "live.json";
const DOC_VERSION = 1;
const DOC_MIGRATIONS: Migrations = { 0: unchanged };
const PERSISTED = ["folders", "folderOrder", "items", "known", "unread", "hidden", "completed", "expandedStacks", "accounts", "config", "calendar", "meetingGroups", "dismissedAlerts", "dismissedNow"] as const;

function load(): Partial<LiveState> {
  try {
    return (parseSaved(readDocument(DOC), DOC_VERSION, DOC_MIGRATIONS) as Partial<LiveState> | null) ?? {};
  } catch {
    return {};
  }
}

const saved = load();

const FOLDER_OPTION_DEFAULTS = { groupStacks: true, showCompleted: true } satisfies Partial<LiveFolder>;

const withOptionDefaults = (folders: Record<string, LiveFolder> = {}) =>
  Object.fromEntries(Object.entries(folders).map(([id, f]) => [id, { ...FOLDER_OPTION_DEFAULTS, ...f }]));

export const useLive = create<LiveState>()(() => ({
  folders: withOptionDefaults(saved.folders),
  folderOrder: saved.folderOrder ?? [],
  items: saved.items ?? {},
  known: saved.known ?? {},
  unread: saved.unread ?? {},
  hidden: saved.hidden ?? {},
  completed: saved.completed ?? {},
  completing: {},
  status: {},
  expandedStacks: saved.expandedStacks ?? {},
  showAll: {},
  accounts: saved.accounts ?? {},
  config: { ...DEFAULT_CONFIG, ...saved.config },
  calendar: { ...DEFAULT_CALENDAR, ...saved.calendar },
  meetingGroups: saved.meetingGroups ?? {},
  dismissedAlerts: saved.dismissedAlerts ?? [],
  dismissedNow: keepDismissedNow(saved.dismissedNow, Date.now()),
}));

export const live = () => useLive.getState();
const setLive = (patch: Partial<LiveState> | ((s: LiveState) => Partial<LiveState>)) => useLive.setState(patch);

export const showAllKey = (folderId: string, section: string) => `${folderId}:${section}`;

let timer: ReturnType<typeof setTimeout> | undefined;
useLive.subscribe((s, prev) => {
  if (PERSISTED.every((k) => s[k] === prev[k])) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const s = live();
    try {
      writeDocument(DOC, versionedJson(Object.fromEntries(PERSISTED.map((k) => [k, s[k]])), DOC_VERSION));
    } catch (error) {
      console.warn("Couldn't save live folders", error);
    }
  }, 800);
});

let counter = 0;
const newId = () => `lf-${Date.now().toString(36)}-${(++counter).toString(36)}`;

export const FOLDER_DEFAULTS: Record<LiveFolderKind, { name: string; sources: LiveSourceId[] }> = {
  pullRequests: { name: "Pull Requests", sources: ["github"] },
  documents: { name: "Documents", sources: ["notion"] },
};

export function createFolder(profileId: string, kind: LiveFolderKind, sources?: LiveSourceId[]): string {
  const id = newId();
  const folder: LiveFolder = {
    id,
    profileId,
    kind,
    name: FOLDER_DEFAULTS[kind].name,
    icon: null,
    collapsed: false,
    sources: sources ?? FOLDER_DEFAULTS[kind].sources,
    filters: { authored: true, reviewRequests: true },
    ...FOLDER_OPTION_DEFAULTS,
    createdAt: Date.now(),
  };
  setLive((s) => ({
    folders: { ...s.folders, [id]: folder },
    folderOrder: [...s.folderOrder, id],
    status: { ...s.status, [id]: { state: "initializing", lastFetch: null, error: null } },
  }));
  return id;
}

export function updateFolder(id: string, patch: Partial<Omit<LiveFolder, "id" | "profileId" | "kind">>) {
  setLive((s) => (s.folders[id] ? { folders: { ...s.folders, [id]: { ...s.folders[id]!, ...patch } } } : {}));
}

const without = <T>(record: Record<string, T>, key: string) => {
  const { [key]: _, ...rest } = record;
  return rest;
};

const stackIds = (items: LiveItem[] | undefined) => (items ?? []).flatMap((it) => (it.pr?.stack ? [it.pr.stack.id] : []));

function stacksOnlyIn(s: LiveState, id: string): Set<string> {
  const elsewhere = new Set(s.folderOrder.filter((f) => f !== id).flatMap((f) => [...stackIds(s.items[f]), ...stackIds(s.hidden[f])]));
  return new Set([...stackIds(s.items[id]), ...stackIds(s.hidden[id])].filter((stack) => !elsewhere.has(stack)));
}

export function removeFolder(id: string) {
  setLive((s) => {
    const stacks = stacksOnlyIn(s, id);
    return {
      folders: without(s.folders, id),
      folderOrder: s.folderOrder.filter((f) => f !== id),
      items: without(s.items, id),
      known: without(s.known, id),
      unread: without(s.unread, id),
      hidden: without(s.hidden, id),
      completed: without(s.completed, id),
      completing: without(s.completing, id),
      status: without(s.status, id),
      showAll: Object.fromEntries(Object.entries(s.showAll).filter(([key]) => !key.startsWith(showAllKey(id, "")))),
      expandedStacks: Object.fromEntries(Object.entries(s.expandedStacks).filter(([stack]) => !stacks.has(stack))),
    };
  });
}

export const showAllIn = (folderId: string, section: string) => setLive((s) => ({ showAll: { ...s.showAll, [showAllKey(folderId, section)]: true } }));

export const toggleStack = (stackId: string) => setLive((s) => ({ expandedStacks: { ...s.expandedStacks, [stackId]: s.expandedStacks[stackId] === false } }));

export function markUnread(folderId: string, itemId: string) {
  setLive((s) => ((s.unread[folderId] ?? []).includes(itemId) ? {} : { unread: { ...s.unread, [folderId]: [...(s.unread[folderId] ?? []), itemId] } }));
}

export function arrangeFolders(placed: { id: string; after: string | null }[]) {
  setLive((s) => {
    const ids = placed.map((p) => p.id).filter((id) => s.folders[id]);
    if (!ids.length) return {};
    const moved = placed.filter((p) => s.folders[p.id] && s.folders[p.id]!.after !== p.after);
    const folders = moved.length ? { ...s.folders } : s.folders;
    for (const p of moved) folders[p.id] = { ...folders[p.id]!, after: p.after };
    const slots = s.folderOrder.flatMap((id, i) => (ids.includes(id) ? [i] : []));
    const folderOrder = [...s.folderOrder];
    slots.forEach((slot, i) => {
      folderOrder[slot] = ids[i]!;
    });
    const reordered = folderOrder.some((id, i) => id !== s.folderOrder[i]);
    if (!moved.length && !reordered) return {};
    return { folders, folderOrder: reordered ? folderOrder : s.folderOrder };
  });
}

const MAX_KNOWN = 600;
const MAX_COMPLETED = 20;

export function applyFetch(folderId: string, fetched: LiveItem[], gone: Record<string, CompletionState>, now = Date.now(), quiet: Set<string> = new Set()) {
  setLive((s) => {
    if (!s.folders[folderId]) return {};
    const closed = (id: string) => gone[id] === "merged" || gone[id] === "closed";
    const stillHidden = (s.hidden[folderId] ?? []).filter((it) => !closed(it.id));
    const hiddenIds = new Set(stillHidden.map((it) => it.id));
    const next = fetched.filter((it) => !hiddenIds.has(it.id));
    const known = new Set(s.known[folderId] ?? []);
    const first = known.size === 0 && !s.status[folderId]?.lastFetch;
    const fresh = next.filter((it) => !known.has(it.id)).map((it) => it.id);
    const unreadFresh = fresh.filter((id) => !quiet.has(id));
    const ids = new Set(next.map((it) => it.id));
    const prev = s.items[folderId] ?? [];
    const animating = new Set(s.completing[folderId] ?? []);
    const leaving = prev.filter((it) => !ids.has(it.id) && gone[it.id] && !animating.has(it.id));
    const merged = [...next];
    for (const it of prev) if (!ids.has(it.id) && (animating.has(it.id) || leaving.includes(it))) merged.splice(Math.min(prev.indexOf(it), merged.length), 0, it);
    const completed = [
      ...leaving.map((item) => ({ item, state: gone[item.id]!, at: now })),
      ...(s.completed[folderId] ?? []).filter((c) => !ids.has(c.item.id) && !leaving.some((l) => l.id === c.item.id)),
    ].slice(0, MAX_COMPLETED);
    const stillThere = new Set(merged.map((it) => it.id));
    return {
      items: { ...s.items, [folderId]: merged },
      hidden: stillHidden.length === (s.hidden[folderId] ?? []).length ? s.hidden : { ...s.hidden, [folderId]: stillHidden },
      known: { ...s.known, [folderId]: [...known, ...fresh].slice(-MAX_KNOWN) },
      unread: { ...s.unread, [folderId]: first ? [] : [...new Set([...(s.unread[folderId] ?? []), ...unreadFresh])].filter((id) => stillThere.has(id)) },
      completed: leaving.length || (s.completed[folderId] ?? []).length !== completed.length ? { ...s.completed, [folderId]: completed } : s.completed,
      completing: leaving.length ? { ...s.completing, [folderId]: [...(s.completing[folderId] ?? []), ...leaving.map((l) => l.id)] } : s.completing,
      status: { ...s.status, [folderId]: { state: "idle", lastFetch: now, error: null } },
    };
  });
}

export function finishCompleting(folderId: string, ids: string[]) {
  setLive((s) => ({
    items: { ...s.items, [folderId]: (s.items[folderId] ?? []).filter((it) => !ids.includes(it.id)) },
    completing: { ...s.completing, [folderId]: (s.completing[folderId] ?? []).filter((id) => !ids.includes(id)) },
    unread: { ...s.unread, [folderId]: (s.unread[folderId] ?? []).filter((id) => !ids.includes(id)) },
  }));
}

export function setStatus(folderId: string, status: Partial<FolderStatus>) {
  setLive((s) => {
    const current = s.status[folderId] ?? { state: "idle" as const, lastFetch: null, error: null };
    return { status: { ...s.status, [folderId]: { ...current, ...status } } };
  });
}

export function markRead(folderId: string, itemIds?: string[]) {
  setLive((s) => {
    const unread = s.unread[folderId] ?? [];
    const next = itemIds ? unread.filter((id) => !itemIds.includes(id)) : [];
    return next.length === unread.length ? {} : { unread: { ...s.unread, [folderId]: next } };
  });
}

export function hideItems(folderId: string, hiding: LiveItem[]) {
  const itemIds = hiding.map((it) => it.id);
  const shown = (id: string) => !itemIds.includes(id);
  setLive((s) => ({
    hidden: { ...s.hidden, [folderId]: [...(s.hidden[folderId] ?? []).filter((it) => shown(it.id)), ...hiding] },
    items: { ...s.items, [folderId]: (s.items[folderId] ?? []).filter((it) => shown(it.id)) },
    unread: { ...s.unread, [folderId]: (s.unread[folderId] ?? []).filter(shown) },
    completing: { ...s.completing, [folderId]: (s.completing[folderId] ?? []).filter(shown) },
    completed: { ...s.completed, [folderId]: (s.completed[folderId] ?? []).filter((c) => shown(c.item.id)) },
  }));
}

export function unhide(folderId: string) {
  setLive((s) => {
    const hidden = s.hidden[folderId] ?? [];
    return hidden.length ? { hidden: without(s.hidden, folderId), items: { ...s.items, [folderId]: [...(s.items[folderId] ?? []), ...hidden] } } : {};
  });
}

export function setAccount(source: LiveSourceId, account: LiveAccount | null) {
  setLive((s) => {
    const accounts = { ...s.accounts };
    if (account) accounts[source] = account;
    else delete accounts[source];
    return { accounts };
  });
}

export const updateConfig = (patch: Partial<LiveConfig>) => setLive((s) => ({ config: { ...s.config, ...patch } }));
export const updateCalendarSettings = (patch: Partial<CalendarSettings>) => setLive((s) => ({ calendar: { ...s.calendar, ...patch } }));

export function dismissAlert(occurrence: string) {
  setLive((s) => (s.dismissedAlerts.includes(occurrence) ? {} : { dismissedAlerts: [...s.dismissedAlerts, occurrence].slice(-200) }));
}

export function dismissNowBadge(event: { occurrence: string; end: number }, now = Date.now()) {
  setLive((s) => (s.dismissedNow[event.occurrence] !== undefined ? {} : { dismissedNow: keepDismissedNow({ ...s.dismissedNow, [event.occurrence]: event.end }, now) }));
}

export function setMeetingGroup(group: MeetingGroup | null, groupId?: string) {
  setLive((s) => {
    if (group) return { meetingGroups: { ...s.meetingGroups, [group.groupId]: group } };
    return groupId && s.meetingGroups[groupId] ? { meetingGroups: without(s.meetingGroups, groupId) } : {};
  });
}

