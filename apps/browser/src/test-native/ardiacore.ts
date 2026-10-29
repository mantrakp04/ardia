import type {
  ActionState,
  BookmarkOp,
  CallArgs,
  CallName,
  CallResult,
  CliControlStatus,
  EngineBookmark,
  EngineEvents,
  EventName,
  HistoryChange,
  HistoryChangedBatch,
  InstalledExtension,
  LinkRoute,
  TabStripCommand,
  TabStripTransaction,
} from "@ardia/ardiacore";
import type { EventSubscription } from "expo-modules-core";
import { nativeEvents, unfaked } from "./events";


type TabStripHost = {
  listen(listener: (tx: TabStripTransaction) => void): EventSubscription;
  command(command: TabStripCommand, id: number): unknown;
  snapshot(): Promise<TabStripTransaction>;
};
type ExtensionEngine = {
  list(profile: string): Promise<InstalledExtension[]>;
  install(path: string, profile: string): Promise<string>;
  reload(id: string, profile: string): Promise<void>;
  uninstall(id: string, profile: string): Promise<void>;
};
const testGlobals = globalThis as {
  acTestTabStrip?: TabStripHost;
  acTestCliControl?: (on: boolean | null) => Promise<CliControlStatus> | undefined;
  acTestCliActive?: (tabId: string | null) => Promise<CliControlStatus> | undefined;
  acTestUserScripts?: { engine: ExtensionEngine };
};

type VerbOf<D extends string, N extends string = CallName> = N extends `${D}.${infer V}` ? V : never;
type Call<D extends string, V extends string> = `${D}.${V}` & CallName;
type Handlers<D extends string> = {
  [V in VerbOf<D>]?: (args: CallArgs<Call<D, V>> & { profile: string }) => CallResult<Call<D, V>> | Promise<CallResult<Call<D, V>>>;
};
type FakeDomain = { call(name: string, profile: string, json: string): Promise<string>; addListener: ReturnType<typeof nativeEvents>["addListener"] };

const domainEvents = new Map<string, ReturnType<typeof nativeEvents>>();
const eventsOf = (domain: string) => {
  if (!domainEvents.has(domain)) domainEvents.set(domain, nativeEvents());
  return domainEvents.get(domain)!;
};
export const emitEvent = <E extends EventName>(name: E, data: EngineEvents[E]) => {
  const domain = name.slice(0, name.indexOf("."));
  eventsOf(domain).emit(domain, { name, data });
};

function domain<D extends string, Sync extends object>(name: D, handlers: Handlers<D>, sync?: Sync): FakeDomain & Sync {
  const fake: FakeDomain = {
    call: (verb, profile, json) => {
      const handler = (handlers as Record<string, ((args: object) => unknown) | undefined>)[verb];
      if (!handler) return Promise.reject(Object.assign(new Error(`${name}.${verb} has no test fake yet`), { code: "ERR_UNKNOWN_CALL" }));
      const args = { ...(JSON.parse(json) as Record<string, unknown>), profile };
      try {
        return Promise.resolve(handler(args)).then((value) => JSON.stringify(value ?? null));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    addListener: eventsOf(name).addListener,
  };
  return Object.assign(fake, sync);
}

const laterEvent = <E extends EventName>(name: E, data: EngineEvents[E]) => queueMicrotask(() => emitEvent(name, data));
export const emitDownload = (download: EngineEvents["downloads.changed"]) => emitEvent("downloads.changed", download);
export const emitPermission = (request: EngineEvents["permissions.requested"]) => emitEvent("permissions.requested", request);

export const current = { device: null as string | null };

type Login = { origin: string; url: string; username: string; password: string; created: number };
export const passwordStores = new Map<string | null, Map<string, Login>>();
const logins = () => passwordStores.get(current.device)!;
export const readLogins = async () => [...logins().values()];

type HistoryRow = { title: string; visits: number[] };
export const historyDbs = new Map<string | null, Map<string, Map<string, HistoryRow>>>();
export const chromeHistory = (profile = "", device = current.device) => {
  if (!historyDbs.has(device)) historyDbs.set(device, new Map());
  const dbs = historyDbs.get(device)!;
  if (!dbs.has(profile)) dbs.set(profile, new Map());
  return dbs.get(profile)!;
};
export const historyWatches: string[] = [];

export function chromeHistoryEvent(change: HistoryChange) {
  const wire: HistoryChangedBatch["changes"][number] =
    change.kind === "visit"
      ? { kind: "visit", u: change.url, t: change.title, n: change.visits, at: change.at }
      : change.kind === "modified"
        ? { kind: "modified", rows: change.rows.map((r) => ({ u: r.url, t: r.title, n: r.visits })) }
        : { kind: "deleted", all: change.all, urls: change.urls };
  laterEvent("history.changed", { profile: change.profile, kind: "batch", changes: [wire] });
}

function addVisit(profile: string, url: string, title: string, at: number) {
  const db = chromeHistory(profile);
  const row = db.get(url) ?? { title: "", visits: [] };
  row.visits = [...row.visits, at].sort((a, b) => a - b);
  if (title) row.title = title;
  db.set(url, row);
  chromeHistoryEvent({ kind: "visit", profile, url, title: row.title, visits: row.visits.length, at });
}
export const chromeVisit = (profile: string, url: string, title: string, at = Date.now()) => addVisit(profile, url, title, at);

function queryHistory(profile: string, { maxUrls = 5000, maxVisits = 50 }: { maxUrls?: number; maxVisits?: number }) {
  const entries = [...chromeHistory(profile)]
    .map(([u, r]) => ({ u, t: r.title, n: r.visits.length, v: r.visits.slice(-maxVisits) }))
    .sort((a, b) => (b.v.at(-1) ?? 0) - (a.v.at(-1) ?? 0))
    .slice(0, maxUrls);
  return { entries };
}

function addHistoryVisits(profile: string, { pages, toleranceMs = 1000 }: { pages: { u: string; t: string; v: number[] }[]; toleranceMs?: number }) {
  let added = 0;
  for (const page of pages) {
    const have = [...(chromeHistory(profile).get(page.u)?.visits ?? [])];
    for (const at of [...page.v].sort((a, b) => a - b)) {
      const match = have.findIndex((t) => Math.abs(t - at) <= toleranceMs);
      if (match >= 0) {
        have.splice(match, 1);
        continue;
      }
      addVisit(profile, page.u, chromeHistory(profile).get(page.u)?.title || page.t, at);
      added++;
    }
  }
  return { added };
}

function importHistoryRows(profile: string, { rows }: { rows: { u: string; t: string; l: number }[] }) {
  for (const r of rows) if (!chromeHistory(profile).has(r.u)) chromeHistory(profile).set(r.u, { title: r.t, visits: [r.l] });
  return {};
}

function deleteHistoryUrls(profile: string, { urls }: { urls: string[] }) {
  for (const url of urls) chromeHistory(profile).delete(url);
  chromeHistoryEvent({ kind: "deleted", profile, all: false, urls });
  return {};
}

export const chromeFavicons = new Map<string, string>();
const PNG_URI = "data:image/png;base64,";
function faviconsFor(profile: string, { pages }: { pages: string[] }) {
  const known = pages.filter((p) => chromeFavicons.has(`${profile}|${p}`));
  const png = (p: string) => chromeFavicons.get(`${profile}|${p}`)!.replace(PNG_URI, "");
  return { pages: Object.fromEntries(known.map((p) => [p, { png: png(p), icon: "" }])), icons: {} };
}

type BookmarkNode = { id: string; k: "u" | "f"; t: string; u?: string; a: number; key?: string; parent: string | null; children: string[] };
export const bookmarkDbs = new Map<string | null, Map<string, Map<string, BookmarkNode>>>();
export const chromeBookmarks = (profile = "", device = current.device) => {
  if (!bookmarkDbs.has(device)) bookmarkDbs.set(device, new Map());
  const dbs = bookmarkDbs.get(device)!;
  if (!dbs.has(profile)) {
    const folder = (id: string, t: string): BookmarkNode => ({ id, k: "f", t, a: 0, parent: null, children: [] });
    dbs.set(profile, new Map([["bar", folder("bar", "Bookmarks Bar")], ["other", folder("other", "Other Bookmarks")]]));
  }
  return dbs.get(profile)!;
};

function treeOf(db: Map<string, BookmarkNode>, id: string): EngineBookmark {
  const n = db.get(id)!;
  const key = n.key ? { key: n.key } : {};
  return n.k === "u"
    ? { id: n.id, k: "u", t: n.t, u: n.u, a: n.a, ...key }
    : { id: n.id, k: "f", t: n.t, a: n.a, ...key, c: n.children.map((c) => treeOf(db, c)) };
}

function isAncestor(db: Map<string, BookmarkNode>, node: string, of: string) {
  for (let at: string | null | undefined = of; at; at = db.get(at)?.parent) if (at === node) return true;
  return false;
}

function moveTo(db: Map<string, BookmarkNode>, id: string, parent: string, index?: number) {
  const node = db.get(id)!;
  const old = node.parent ? db.get(node.parent) : undefined;
  if (old) old.children.splice(old.children.indexOf(id), 1);
  const kids = db.get(parent)!.children;
  kids.splice(Math.max(0, Math.min(index ?? kids.length, kids.length)), 0, id);
  node.parent = parent;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function applyOp(db: Map<string, BookmarkNode>, op: BookmarkOp): boolean | "invalid" {
  const node = db.get(op.id);
  const permanent = op.id === "bar" || op.id === "other";
  if (op.op === "remove") {
    if (!node || permanent) return false;
    const drop = (id: string) => {
      db.get(id)!.children.forEach(drop);
      db.delete(id);
    };
    const parent = db.get(node.parent!)!;
    parent.children = parent.children.filter((c) => c !== op.id);
    drop(op.id);
    return true;
  }
  if (op.op === "update") {
    if (!node || permanent) return false;
    if (op.t !== undefined) node.t = op.t;
    if (op.u && node.k === "u") node.u = op.u;
    return true;
  }
  const parent = db.get(op.parent);
  if (!parent || parent.k !== "f") return false;
  if (op.op === "move") {
    if (!node || permanent || isAncestor(db, op.id, op.parent)) return false;
    moveTo(db, op.id, op.parent, op.index);
    return true;
  }
  if (node && op.ifAbsent) return true;
  if (node) {
    if (permanent || isAncestor(db, op.id, op.parent)) return false;
    moveTo(db, op.id, op.parent, op.index);
    node.t = op.t;
    if (op.u && node.k === "u") node.u = op.u;
    return true;
  }
  if (!UUID.test(op.id)) return false;
  if (op.k === "u" && !/^[a-z][a-z0-9+.-]*:/i.test(op.u ?? "")) return "invalid";
  db.set(op.id, { id: op.id, k: op.k, t: op.t, ...(op.k === "u" ? { u: op.u } : {}), children: [], a: op.a, ...(op.key ? { key: op.key } : {}), parent: null });
  moveTo(db, op.id, op.parent, op.index);
  return true;
}

export const bookmarkOpsSent: BookmarkOp[] = [];
function applyBookmarkOps(profile: string, { ops }: { ops: BookmarkOp[] }) {
  bookmarkOpsSent.push(...ops);
  const db = chromeBookmarks(profile);
  let applied = 0;
  const invalid: string[] = [];
  for (const op of ops) {
    const result = applyOp(db, op);
    if (result === "invalid") invalid.push(op.id);
    else if (result) applied++;
    else break;
  }
  return { applied, skipped: ops.length - applied - invalid.length, invalid };
}

export function chromeBookmarkEdit(profile: string, ops: BookmarkOp[]) {
  const db = chromeBookmarks(profile);
  for (const op of ops) applyOp(db, op);
  laterEvent("bookmarks.changed", { profile });
}

const cliStatus = (on: boolean | null): CliControlStatus =>
  on ? { state: "on", port: 0, connections: 0, generation: 0, file: "" } : { state: "off", connections: 0, generation: 0, file: "" };
const cliControl = (on: boolean | null) => testGlobals.acTestCliControl?.(on) ?? cliStatus(on);

export const cancelledDownloads: string[] = [];
export const endedWebKitSessions: string[] = [];
export const removedStagings: string[] = [];
export const stagingRemovals = { ok: true };
export const deletedProfileData: string[] = [];
export const profileDataLeft = new Map<string, string[]>();
export const revealedTabs: string[] = [];
export const installedCrx: { path: string; profile: string }[] = [];
export const linkRoute: { next: LinkRoute } = { next: {} };
export const extensionAnswers = {
  actionStates: async (_tabId: string, _ids: string[]): Promise<Record<string, ActionState>> => ({}),
  sidePanelUrl: async (_tabId: string, _extensionId: string): Promise<string | null> => null,
};

const tabStripHost = () => testGlobals.acTestTabStrip!;
let autofillIds = 0;

const extensionEngine = () => testGlobals.acTestUserScripts?.engine;
function withStrips<Fake extends FakeDomain>(fake: Fake): Fake {
  const addListener = fake.addListener;
  fake.addListener = (name: string, listener: (payload: never) => void) => {
    const own = addListener(name, listener);
    const strips = tabStripHost().listen((tx) => (listener as (event: { name: string; data: unknown }) => void)({ name: "tabs.strips", data: tx }));
    return { remove: () => (own.remove(), strips.remove()) };
  };
  return fake;
}

const loginKey = (args: { origin: string; username: string }) => `${args.origin}\n${args.username}`;

const fakeModules = {
  ArdiaEngine: domain(
    "engine",
    {
      components: () => [],
      tasks: () => [],
      beginTracing: () => false,
      endTracing: () => null,
      isTracing: () => false,
      systemState: () => ({ onBattery: false, batteryLevel: null, lowPowerMode: false, memoryPressure: "normal", physicalMemory: 16 * 2 ** 30 }),
      batterySaver: ({ mode }) => ({ state: 0, active: mode === "on" }),
      trimMemory: () => ({ ok: true }),
      openTaskManager: () => ({ ok: true }),
      cliControlStatus: () => cliControl(null),
      setCliControl: ({ on }) => cliControl(on),
      setCliActiveTab: ({ tabId }) => testGlobals.acTestCliActive?.(tabId) ?? cliStatus(null),
    },
    { inputIdleSeconds: () => 3600 },
  ),
  ArdiaTabs: withStrips(domain(
    "tabs",
    {
      routeLinkTabs: () => linkRoute.next,
      stripCommand: ({ id, command }) => (tabStripHost().command(command, id), null),
      strips: () => tabStripHost().snapshot(),
      lastTabPolicy: () => ({ closesWindow: true }),
    },
    {
      prepareTransfer: () => {},
      releaseTransfer: () => {},
      claimLaunchTab: () => {},
      revealTab: (key: string) => void revealedTabs.push(key),
      dropTabReveals: (key: string) => void revealedTabs.push(`drop over ${key}`),
      revealOffered: (adoptId: string, key: string) => void revealedTabs.push(`${adoptId} over ${key}`),
    },
  )),
  ArdiaWindows: domain("windows", { list: () => [], dev: () => "" }),
  ArdiaDownloads: domain("downloads", {
    cancel: ({ id }) => (cancelledDownloads.push(id), null),
    pause: () => null,
    resume: () => null,
    keep: () => null,
    settings: () => ({ folder: "", askWhereToSave: false, managed: false }),
    setSettings: () => ({ folder: "", askWhereToSave: false, managed: false }),
  }),
  ArdiaPermissions: domain("permissions", {
    resolve: () => null,
    resolveExternalApp: () => null,
    externalAppAllowances: () => [],
    removeExternalAppAllowance: () => null,
  }),
  ArdiaProfiles: domain("profiles", {
    release: () => null,
    deleteData: ({ profile }) => (deletedProfileData.push(profile), { remaining: profileDataLeft.get(profile) ?? [] }),
    clearBrowsingData: () => null,
  }),
  ArdiaSites: domain("sites", {
    setSetting: () => null,
    origins: () => [],
    reset: () => null,
    clearData: () => ({ cookies: 0, storage: true }),
    zoomLevels: () => ({}),
    setZoom: () => null,
  }),
  ArdiaPasswords: domain(
    "passwords",
    {
      list: () => ({
        passwords: [...(passwordStores.get(current.device)?.values() ?? [])].map((l) => ({ origin: l.origin, username: l.username, created: l.created, modified: l.created })),
      }),
      unlock: () => ({ unlocked: true }),
      reveal: (args) => ({ password: passwordStores.get(current.device)?.get(loginKey(args))?.password ?? null }),
      remove: (args) => (logins().delete(loginKey(args)), { ok: true }),
      neverSaveOrigins: () => ({ origins: [] }),
      allowSaving: () => ({ ok: true }),
      export: () => ({ status: "cancelled" }),
      autofillEnabled: () => true,
      setAutofillEnabled: () => null,
    },
    {
      save: async (_profile: string, origin: string, username: string, password: string) => {
        logins().set(`${origin}\n${username}`, { origin: `${origin}/`, url: origin, username, password, created: Date.now() });
        return JSON.stringify({ ok: true });
      },
      update: () => unfaked("ArdiaPasswords", "update"),
    },
  ),
  ArdiaAutofill: domain(
    "autofill",
    {
      settings: () => ({ addresses: true, cards: true }),
      setSettings: () => null,
      addresses: () => ({ addresses: [] }),
      saveAddress: () => ({ id: `address-${++autofillIds}` }),
      cards: () => ({ cards: [] }),
      remove: () => ({ ok: true }),
      cardNumber: () => ({ number: null }),
      showSuggestions: () => false,
    },
    { saveCard: async () => JSON.stringify({ id: `card-${++autofillIds}` }) },
  ),
  ArdiaExtensions: domain("extensions", {
    list: async ({ profile }) => ({ extensions: (await extensionEngine()?.list(profile)) ?? [] }),
    install: async ({ profile, path }) => {
      const engine = extensionEngine();
      if (!engine) throw Object.assign(new Error("no extension engine in this test"), { code: "ERR_ENGINE" });
      return { id: await engine.install(path, profile) };
    },
    setEnabled: () => ({ ok: true }),
    uninstall: async ({ profile, id }) => (await extensionEngine()?.uninstall(id, profile), { ok: true }),
    reload: async ({ profile, id }) => (await extensionEngine()?.reload(id, profile), { ok: true }),
    configure: () => ({ ok: true }),
    chooseFolder: () => null,
    installCrx: ({ profile, path }) => (installedCrx.push({ path: path, profile }), { id: "crx" }),
    resolveInstallPrompt: () => null,
    actionStates: ({ tabId, ids }) => extensionAnswers.actionStates(tabId, ids),
    sidePanelUrl: ({ tabId, extensionId }) => extensionAnswers.sidePanelUrl(tabId, extensionId),
    watchActions: () => null,
    syncState: () => ({ ready: false, extensions: [], pending: [], settling: [], queued: [], intents: [] }),
    syncApply: () => ({ state: "pending" }),
  }),
  ArdiaSearch: domain("search", { engines: () => ({ list: { engines: [] } }), setEngineName: () => null }),
  ArdiaMedia: domain("media", {
    displayMediaSources: () => [],
    selectDevice: () => null,
    cancelDeviceChooser: () => null,
    refreshDeviceChooser: () => null,
    openBluetoothSettings: () => null,
    showCastDialog: () => false,
    startCasting: () => null,
    stopCasting: () => null,
    closeCastDialog: () => null,
    watchCastRoutes: () => null,
    terminateCastRoute: () => null,
    changeCaptureSource: () => false,
    stopCapture: () => false,
  }),
  ArdiaContentBlocker: domain("contentBlocker", {
    setEnabled: () => null,
    setListEnabled: () => null,
    isAllowed: () => false,
    setAllowed: () => null,
  }),
  ArdiaHistory: domain("history", {
    query: ({ profile, ...args }) => queryHistory(profile, args),
    add: ({ profile, ...args }) => addHistoryVisits(profile, args),
    import: ({ profile, ...args }) => importHistoryRows(profile, args),
    deleteUrls: ({ profile, ...args }) => deleteHistoryUrls(profile, args),
    watch: ({ profile }) => (historyWatches.push(profile), null),
  }),
  ArdiaBookmarks: domain("bookmarks", {
    tree: ({ profile }) => ({ bar: treeOf(chromeBookmarks(profile), "bar"), other: treeOf(chromeBookmarks(profile), "other") }),
    apply: ({ profile, ...args }) => applyBookmarkOps(profile, args),
    watch: () => null,
  }),
  ArdiaFavicons: domain("favicons", {
    get: ({ profile, ...args }) => faviconsFor(profile, args),
    set: () => ({ stored: true }),
    fetch: () => null,
  }),
  ArdiaWebView: domain("webView", {
    setDisplayMediaPicker: () => null,
    setPeekModifier: () => null,
    setSplitLinkModifier: () => null,
    setPeekOtherSiteTabs: () => null,
    setSelectionPopover: () => null,
    setCommandScrollZoom: () => null,
    setAutoPictureInPicture: () => null,
    setVideoUpscaling: () => null,
    setVideoUpscalingTestConditions: () => null,
    videoUpscalingState: () => null,
  }),
  ArdiaWebKit: domain("webKit", {
    endPrivateSession: ({ session }) => (endedWebKitSessions.push(session), null),
    removeDownloadStaging: ({ path }) => (removedStagings.push(path), stagingRemovals.ok),
    cookieStoreKey: ({ profile }) => profile,
    importCookies: ({ cookies }) => cookies.length,
    passkeyAccess: () => ({ entitled: false, status: "entitlementRequired" }),
    requestPasskeyAccess: () => ({ entitled: false, status: "entitlementRequired" }),
  }),
  ArdiaSwipe: {
    haptic: () => {},
    switchPager: () => Promise.resolve(false),
    stepPager: () => Promise.resolve(false),
    selectPager: () => Promise.resolve(false),
    pagerState: () => null,
    devPagerState: () => Promise.resolve(null),
    devSimulate: () => unfaked("ArdiaSwipe", "devSimulate"),
  },
};

export const ardiaCoreNativeModules: Record<string, object> = fakeModules;
