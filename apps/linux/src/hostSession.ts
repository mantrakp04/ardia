import { registerSessionCloseHooks } from "./sessionClose";
import type { BrowserState, HydrateData } from "../../browser/src/state/browser/store";
import type { BrowserWindow, MainWindow, Tab } from "../../browser/src/state/browser/types";
import type { ArdiaHost } from "./host";
import { reportHostError } from "./host.ts";
import { canonicalSessionValue, cloneSessionValue, equalSessionValue, mergeSession } from "./hostSessionMerge.ts";
import { sessionStatePatch } from "./hostSessionState.ts";
import { createWindowDeparture } from "./windowDeparture.ts";
import { parkWindowPins } from "../../browser/src/state/pins/parkedPins";
import { inPinnedContainer, isIncognitoProfile, newId, snapshotTab } from "../../browser/src/state/browser/model";
import { withPrivateWindow } from "./hostWindowProfiles.ts";
import { sessionWithSplitSlots, sessionWithTabPages, sessionWithTabPins } from "../../browser/src/state/session/savedShapes";
import { splitTabIds } from "../../browser/src/state/splits/splits";
import { sessionWithPinChoiceStamps } from "../../browser/src/state/pins/pinChoices";
import type { SavedObject } from "../../browser/src/lib/savedDocument";

type StoredWindow = Partial<BrowserWindow> & { incognito?: unknown; originalProfileId?: unknown };

const windowKind = (w: StoredWindow): BrowserWindow["kind"] => w.kind === "small" || w.kind === "private" || w.kind === "main" ? w.kind : w.incognito === true ? "private" : "main";
const shapedWindow = ({ incognito: _i, originalProfileId: _o, ...w }: StoredWindow) => ({ ...w, kind: windowKind(w) }) as BrowserWindow;
const keyedById = <T,>(list: unknown): Record<string, T> | undefined =>
  Array.isArray(list) ? Object.fromEntries(list.filter((v): v is T & { id: string } => !!v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string").map((v) => [v.id, v])) : undefined;

export function currentSessionShape(saved: HydrateData): HydrateData {
  const doc = { ...saved, tabs: Object.values(saved.tabs ?? {}), splits: Object.values(saved.splits ?? {}) } as unknown as SavedObject;
  const shaped = sessionWithSplitSlots(sessionWithTabPins(sessionWithTabPages(doc))) as unknown as HydrateData & { tabs: unknown; splits: unknown };
  return {
    ...shaped,
    ...(saved.tabs ? { tabs: keyedById<Tab>(shaped.tabs) } : { tabs: undefined }),
    ...(saved.splits ? { splits: keyedById(shaped.splits) } : { splits: undefined }),
    ...(saved.windows ? { windows: Object.fromEntries(Object.entries(saved.windows).map(([id, w]) => [id, shapedWindow(w as StoredWindow)])) } : {}),
  } as HydrateData;
}

const withoutAbsent = (session: HydrateData): HydrateData =>
  Object.fromEntries(Object.entries(session).filter(([, value]) => value !== undefined)) as HydrateData;
const LEGACY_TAB_FIELDS = ["navigation", "adoptId", "wakeAdoptId", "pageIn", "unloaded", "pinned", "pinnedAsRow", "tileFolder"];
const legacyTab = (tab: unknown) => !!tab && typeof tab === "object" && (!("page" in tab) || !("pin" in tab) || LEGACY_TAB_FIELDS.some((key) => key in tab));
const legacyWindow = (w: unknown) => !!w && typeof w === "object" && ("incognito" in w || "originalProfileId" in w || !["main", "private", "small"].includes((w as StoredWindow).kind ?? ""));
const legacySplit = (split: unknown) => !!split && typeof split === "object" && !("slots" in split);
const legacyEntries = (session: HydrateData) => [
  ...[...(session.closedTabs ?? []), ...(session.cleanedTabs ?? [])].map((entry) => (entry as { tab?: unknown }).tab),
  ...[...(session.closedWindows ?? []), ...(session.closedGroups ?? []), ...(session.deletedGroups ?? [])].flatMap((entry) => (entry as { tabs?: unknown[] }).tabs ?? []),
  ...Object.values(session.parkedPins ?? {}).flatMap((park) => (park as { tabs?: unknown[] }).tabs ?? []),
].some((tab) => !!tab && typeof tab === "object" && ["pinned", "pinnedAsRow", "tileFolder"].some((key) => key in tab));
const legacySession = (session: HydrateData) =>
  Object.values(session.tabs ?? {}).some(legacyTab) || Object.values(session.windows ?? {}).some(legacyWindow) ||
  Object.values(session.splits ?? {}).some(legacySplit) || legacyEntries(session);

const legacyPinChoices = (session: HydrateData) =>
  Object.values(session.pinChoices ?? {}).some((mine) => Object.values(mine ?? {}).some((choice) => typeof choice !== "string"));
const withPinChoiceStamps = (session: HydrateData) =>
  legacyPinChoices(session) ? sessionWithPinChoiceStamps(session as unknown as SavedObject) as unknown as HydrateData : session;

export const linuxSessionShape = (saved: HydrateData): HydrateData => withPinChoiceStamps(legacySession(saved) ? withoutAbsent(currentSessionShape(saved)) : saved);

const CLOSED_WINDOW_LIMIT = 10;
const inClosingOrder = <T extends { closedAt: number }>(entries: T[]) => [...entries].sort((a, b) => a.closedAt - b.closedAt).slice(-CLOSED_WINDOW_LIMIT);

function withoutRestoredWindows(saved: HydrateData, now: number): HydrateData {
  const source = { tabs: saved.tabs ?? {}, groups: saved.groups ?? {}, splits: saved.splits ?? {}, history: {}, profiles: saved.profiles ?? {} };
  const windows = Object.values(saved.windows ?? {}).filter((w) => w.kind === "main");
  let parkedPins = saved.parkedPins ?? {};
  for (const w of windows) parkedPins = parkWindowPins(parkedPins, w, source);
  const closed = windows.map((w) => ({
    kind: "window" as const,
    id: newId("cw"),
    window: { profileId: w.profileId, sidebarOpen: w.sidebarOpen, frame: w.frame },
    tabs: w.tabIds.map((id) => source.tabs[id]).filter((t): t is Tab => !!t && !inPinnedContainer(source, t.id))
      .map((t) => ({ ...snapshotTab(t), active: Object.values(w.activeTabIds).includes(t.id) })),
    groups: [],
    closedAt: now,
  })).filter((c) => c.tabs.some((t) => t.url));
  return {
    ...saved, parkedPins, closedWindows: inClosingOrder([...(saved.closedWindows ?? []), ...closed]),
    windows: {}, windowOrder: [], tabs: {}, groups: {}, splits: {}, focusedWindowId: null,
  };
}

const seedProfile = ({ profileId, pageProfile }: ArdiaHost["bootstrap"]) =>
  pageProfile && !isIncognitoProfile(pageProfile) ? pageProfile : profileId;

export function initialHostSession(host: ArdiaHost, saved: HydrateData | null | undefined, now = Date.now()): HydrateData {
  const { windowId } = host.bootstrap;
  const profileId = seedProfile(host.bootstrap);
  if (!windowId || !profileId || /[\\/\0]/.test(windowId + profileId)) throw new Error("Invalid Ardia host bootstrap IDs");
  if (saved) saved = linuxSessionShape(saved);
  if (host.bootstrap.startup !== false && saved?.settings?.restoreSession === false) saved = withoutRestoredWindows(saved, now);
  if (saved?.closedWindows) saved = { ...saved, closedWindows: inClosingOrder(saved.closedWindows) };
  const privateSession = withPrivateWindow(host, saved ?? {});
  if (privateSession) return privateSession;
  const profile = { id: profileId, name: "Personal", color: "plum" as const, icon: null, createdAt: now };
  const profiles = { ...saved?.profiles };
  profiles[profileId] ??= profile;
  if (saved?.windows?.[windowId]?.tabIds.some((id) => saved.tabs?.[id])) return { ...saved, profiles, focusedWindowId: windowId };
  const tabId = `t_${crypto.randomUUID()}`;
  const tab: Tab = {
    id: tabId, windowId, profileId, url: "", title: "", favicon: null, pin: null, muted: false, zoom: 1,
    customTitle: null, customIcon: null, pinnedUrl: null, page: { kind: "idle" }, openerId: null, createdAt: now, lastActiveAt: now,
  };
  const browserWindow: BrowserWindow = {
    id: windowId, profileId, kind: "main", tabIds: [tabId], activeTabIds: { [profileId]: tabId }, sidebarOpen: true, frame: null, createdAt: now,
  };
  return {
    ...saved, profiles, profileOrder: [...new Set([...(saved?.profileOrder ?? []), profileId])],
    windows: { ...saved?.windows, [windowId]: browserWindow },
    windowOrder: [...new Set([...(saved?.windowOrder ?? []), windowId])],
    tabs: { ...saved?.tabs, [tabId]: tab }, focusedWindowId: windowId,
  };
}

const publicProfile = (profile: string) => !profile.startsWith("incognito:");
const savedPageKind = (tab: Tab): Tab["page"] => ({ kind: tab.page.kind === "asleep" || tab.page.kind === "frozen" ? "asleep" : "idle" });
const publicTabs = (entry: { tabs: { profileId: string }[] }) => entry.tabs.every((tab) => publicProfile(tab.profileId));
const publicTable = <T,>(table: Record<string, T>) => Object.fromEntries(Object.entries(table).filter(([id]) => publicProfile(id)));

export function snapshotHostSession(s: BrowserState): HydrateData {
  const windows = Object.fromEntries(Object.values(s.windows).filter((w): w is MainWindow => w.kind === "main").map(({ chromeWindow: _, ...w }) => [w.id, w]));
  const tabs = Object.fromEntries(Object.values(s.tabs)
    .filter((t) => windows[t.windowId] && publicProfile(t.profileId) && !Object.values(s.peeks).some((p) => p.tabId === t.id))
    .map((tab): [string, Tab] => [tab.id, { ...tab, page: savedPageKind(tab) }]));
  for (const w of Object.values(windows)) {
    w.tabIds = w.tabIds.filter((id) => tabs[id]);
    w.activeTabIds = Object.fromEntries(Object.entries(w.activeTabIds).filter(([, id]) => tabs[id]));
  }
  return {
    profiles: publicTable(s.profiles), profileOrder: s.profileOrder.filter(publicProfile), orphanedProfileData: s.orphanedProfileData,
    windows, windowOrder: s.windowOrder.filter((id) => windows[id]), tabs,
    focusedWindowId: s.ui.focusOrder.find((id) => windows[id]) ?? null, lastProfileId: s.ui.lastProfileId,
    groups: Object.fromEntries(Object.entries(s.groups).filter(([, g]) => windows[g.windowId] && publicProfile(g.profileId)).map(([id, g]) => [id, { ...g, tabIds: g.tabIds.filter((key) => tabs[key]) }])),
    splits: Object.fromEntries(Object.entries(s.splits).filter(([, split]) => windows[split.windowId] && splitTabIds(split).every((key) => tabs[key]))),
    closedTabs: s.closedTabs.filter((c) => publicProfile(c.tab.profileId)), closedWindows: s.closedWindows.filter(publicTabs),
    closedGroups: s.closedGroups.filter(publicTabs), deletedGroups: s.deletedGroups.filter(publicTabs), cleanedTabs: s.cleanedTabs.filter((c) => publicProfile(c.tab.profileId)),
    parkedPins: publicTable(s.parkedPins), pinChoices: publicTable(s.pinChoices), pinSync: publicTable(s.pinSync),
    settings: s.settings,
  };
}

type SessionPair = { base: HydrateData; session: HydrateData };
const sessionObject = (value: unknown): value is HydrateData => value !== null && typeof value === "object" && !Array.isArray(value);

export function createSessionWriter(host: ArdiaHost, initial: HydrateData = {}, onCanonical?: (base: HydrateData, session: HydrateData) => void) {
  let writes = Promise.resolve();
  let canonical = cloneSessionValue(initial);
  let observation = 0;
  let generation = 0;
  let pending: SessionPair | undefined;
  let latest: SessionPair | undefined;
  let issued: SessionPair | undefined;
  let issuedFailed = false;
  let failedWrite: Promise<void> | undefined;
  let dirty = false;
  let finalized = false;
  let finalWrite = Promise.resolve();
  const acceptCanonical = (session: HydrateData) => {
    canonical = cloneSessionValue(session);
    observation++;
  };
  const reconcile = (session: HydrateData, needsWrite: boolean) => {
    if (finalized) return;
    generation++;
    latest = { base: cloneSessionValue(canonical), session: cloneSessionValue(session) };
    pending = needsWrite ? latest : undefined;
    dirty = needsWrite;
  };
  const flush = () => {
    if (finalized) return finalWrite;
    if (!pending) return writes;
    const pair = pending;
    const version = generation;
    pending = undefined;
    const write = writes.catch((error) => { if (!finalized) reportHostError(error); }).then(async () => {
      if (finalized || version !== generation) return;
      issued = pair;
      issuedFailed = false;
      failedWrite = undefined;
      const observed = observation;
      try {
        const reply = await host.invoke("session.write", pair);
        if (finalized) return;
        if (observed === observation && sessionObject(reply)) {
          const shaped = linuxSessionShape(reply);
          acceptCanonical(shaped);
          onCanonical?.(pair.session, shaped);
        }
        if (latest === pair) dirty = false;
      } catch (error) {
        if (issued === pair) {
          issuedFailed = true;
          failedWrite = write;
        }
        throw error;
      }
    });
    writes = write;
    return writes;
  };
  const drain = async () => {
    if (issuedFailed && failedWrite === writes) {
      if (dirty && !pending && latest) pending = latest;
      else if (!dirty && !pending) {
        writes = Promise.resolve();
        issuedFailed = false;
        failedWrite = undefined;
      }
    }
    for (let pass = 0; pass < 32; pass++) {
      const active = flush();
      await active;
      if (active === writes && !pending) return;
    }
    throw new Error("The session is still changing; save it again before closing");
  };
  const flushFinal = () => {
    if (finalized) return finalWrite;
    finalized = true;
    generation++;
    pending = undefined;
    if (!dirty || !latest || latest === issued && !issuedFailed) return finalWrite;
    issued = latest;
    try {
      finalWrite = Promise.resolve(host.invoke("session.write", latest)).then(() => {});
    } catch (error) {
      finalWrite = Promise.reject(error);
    }
    return finalWrite;
  };
  return { queue: (session: HydrateData) => reconcile(session, true), reconcile, acceptCanonical, flush, drain, flushFinal };
}

type SessionStore = {
  getState(): BrowserState;
  setState(patch: Partial<BrowserState>): void;
  subscribe(listener: (s: BrowserState) => void): () => void;
};

const withoutFocus = ({ focusedWindowId: _, lastProfileId: _last, ...session }: HydrateData) => session;
const sessionSources = (s: BrowserState) => [s.profiles, s.profileOrder, s.orphanedProfileData, s.windows, s.windowOrder, s.tabs, s.groups, s.splits, s.peeks, s.closedTabs, s.closedWindows, s.closedGroups, s.deletedGroups, s.cleanedTabs, s.parkedPins, s.pinChoices, s.pinSync, s.settings, s.ui.focusOrder, s.ui.lastProfileId];

type StandIn = { windowId: string; profileId?: string };

function windowStandIn(host: ArdiaHost, state: BrowserState, initial: HydrateData): StandIn | undefined {
  const { windowId, startup } = host.bootstrap;
  const w = state.windows[windowId];
  if (startup !== false || !w || w.kind === "private" || initial.windows?.[windowId]) return undefined;
  return initial.profiles?.[w.profileId] ? { windowId } : { windowId, profileId: w.profileId };
}

function withoutStandIn(state: BrowserState, standIn: StandIn | undefined): BrowserState {
  if (!standIn) return state;
  const { [standIn.windowId]: _, ...windows } = state.windows;
  const profiles = { ...state.profiles };
  if (standIn.profileId) delete profiles[standIn.profileId];
  return {
    ...state, windows, profiles,
    windowOrder: state.windowOrder.filter((id) => id !== standIn.windowId),
    profileOrder: state.profileOrder.filter((id) => id !== standIn.profileId),
    ui: { ...state.ui, focusOrder: state.ui.focusOrder.filter((id) => id !== standIn.windowId) },
  };
}

export function startHostPersistence(host: ArdiaHost, store: SessionStore, stored: HydrateData = host.bootstrap.session ?? {}, snapshot: (state: BrowserState, canonical: HydrateData) => HydrateData = snapshotHostSession) {
  const initial = linuxSessionShape(stored);
  let canonical = initial;
  let standIn = windowStandIn(host, store.getState(), initial);
  const snapshotOf = (state: BrowserState) => snapshot(withoutStandIn(state, standIn), canonical);
  const writer = createSessionWriter(host, initial, (base, session) => receive(base, session));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = canonicalSessionValue(initial)!;
  let lastSources: unknown[] = [];
  let closing = false;
  const closeTokens = new Set<string>();
  let frozen: HydrateData | undefined;
  let applying = false;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    void writer.flush().catch((error) => { if (!closing) reportHostError(error); });
  };
  const queue = (s: BrowserState) => {
    if (closing || applying || closeTokens.size) return;
    const sources = sessionSources(s);
    if (sources.every((source, index) => source === lastSources[index])) return;
    lastSources = sources;
    const session = snapshotOf(s);
    const json = canonicalSessionValue(session)!;
    if (json === last) return;
    last = json;
    writer.queue(session);
    timer ??= setTimeout(flush, 300);
  };
  const receive = (base: HydrateData, session: HydrateData) => {
    if (closing) return;
    const state = store.getState();
    const local = frozen ?? snapshotOf(state);
    canonical = session;
    const merged = mergeSession(base, local, session);
    if (standIn && merged.windows?.[standIn.windowId]) standIn = undefined;
    const runtime = { ...merged, ...(merged.closedWindows && { closedWindows: inClosingOrder(merged.closedWindows) }), settings: { ...state.settings, ...merged.settings } };
    const patch = sessionStatePatch(state, snapshotHostSession(withoutStandIn(state, standIn)), runtime);
    applying = true;
    try {
      if (Object.keys(patch).length) store.setState(patch);
    } finally {
      applying = false;
    }
    const current = store.getState();
    const snapshot = snapshotOf(current);
    if (closeTokens.size) frozen = snapshot;
    const outstanding = !equalSessionValue(withoutFocus(snapshot), withoutFocus(session));
    lastSources = sessionSources(current);
    last = canonicalSessionValue(snapshot)!;
    writer.reconcile(snapshot, outstanding);
    if (outstanding && !closeTokens.size) timer ??= setTimeout(flush, 300);
    else {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const stopCloseHooks = registerSessionCloseHooks({
    quiesce: (token) => {
      if (!closeTokens.size) {
        queue(store.getState());
        frozen = snapshotOf(store.getState());
      }
      closeTokens.add(token);
      clearTimeout(timer);
      timer = undefined;
    },
    resume: (token) => {
      closeTokens.delete(token);
      if (closeTokens.size) return;
      frozen = undefined;
      queue(store.getState());
    },
  });
  queue(store.getState());
  const stop = store.subscribe(queue);
  const stopEvents = host.onEvent((module, event, payload) => {
    if (closing || module !== "ArdiaHost" || event !== "session" || !sessionObject(payload)) return;
    const update = payload as { base?: unknown; session?: unknown };
    if (!sessionObject(update.base) || !sessionObject(update.session)) return;
    const session = linuxSessionShape(update.session);
    writer.acceptCanonical(session);
    receive(linuxSessionShape(update.base), session);
  });
  if (standIn) {
    void Promise.resolve(host.invoke("session.read", {})).then((saved) => {
      if (closing || !sessionObject(saved)) return;
      const session = linuxSessionShape(saved);
      writer.acceptCanonical(session);
      receive(canonical, session);
    }).catch(reportHostError);
  }
  const final = () => {
    if (closing) return;
    if (closeTokens.size) { closing = true; clearTimeout(timer); timer = undefined; return; }
    queue(store.getState());
    closing = true;
    clearTimeout(timer);
    timer = undefined;
    void writer.flushFinal().catch(() => {});
  };
  const onVisibility = () => { if (document.hidden) flush(); };
  const stopClosing = host.onBeforeClose?.(final);
  if (!host.onBeforeClose) window.addEventListener("pagehide", final);
  document.addEventListener("visibilitychange", onVisibility);
  const dispose = () => {
    stopCloseHooks();
    stop();
    stopEvents();
    if (!closing) flush();
    stopClosing?.();
    window.removeEventListener("pagehide", final);
    document.removeEventListener("visibilitychange", onVisibility);
  };
  const departure = (windowId: string) => {
    const state = store.getState();
    return { base: snapshotOf(state), session: snapshotOf(createWindowDeparture(state, windowId)(state)) };
  };
  return Object.assign(dispose, { flush: () => { queue(store.getState()); clearTimeout(timer); timer = undefined; return writer.drain(); }, departure });
}
