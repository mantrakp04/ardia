import { Clock } from "../hlc.ts";
import { emptyScope, restoreJournal, syncScope, visible, type Adapter, type Listing, type LogFile, type ScopeOptions, type ScopeState, type Transport } from "../scope.ts";
import {
  bookmarksAdapter,
  deviceAdapter,
  deviceTabsAdapter,
  historyAdapter,
  historyExpired,
  HISTORY_WINDOW_MS,
  isWebUrl,
  sendsAdapter,
  type Ack,
  type BookmarkOp,
  type LocalTab,
  type LocalVisit,
  type PendingSend,
  type SendValue,
} from "./adapters.ts";
import { buildView, dataOwner, defaultProfileId, liveProfiles, type View } from "./view.ts";

export type ChainStatus = "ok" | "missing" | "unavailable";

export type Host = {
  chainStatus(): string;
  read(scope: string, knownJSON: string): string;
  write(scope: string, payload: string): string;
  remove(scope: string, idsJSON: string): string;
  persistJournal(scope: string, batchesJSON: string): string;
  saveState(stateJSON: string, seqsJSON: string): string;
};

export type CompanionState = {
  v: 1;
  device: string;
  clock: string | null;
  scopes: Record<string, ScopeState>;
  sends: PendingSend[];
  acks: Ack[];
  bookmarks: BookmarkOp[];
  floors: Record<string, Record<string, number>>;
  pulled: Record<string, true>;
};

export type CycleInput = {
  name: string;
  now?: number;
  retiring?: boolean;
  tabs?: LocalTab[] | null;
  visits?: LocalVisit[] | null;
};

export type Received = { profile: string; key: string; u: string; t: string; from: string; fromName: string | null; at: number };
export type Removal = { profile: string; urls: string[] };

export type CycleOutput = {
  status: ChainStatus;
  view?: View;
  received: Received[];
  historyRemoved: Removal[];
  published: number;
  changed: number;
  pending: number;
  saved: boolean;
};

const APP = "app";
const profileScope = (syncId: string) => `p:${syncId}`;

let companion: CompanionState | null = null;
let savedJSON = "";
let savedPrint = "";
let viewJSON = "";

const host = (): Host => {
  const h = (globalThis as { __host?: Host }).__host;
  if (!h) throw new Error("the sync host isn't registered");
  return h;
};

function loaded(): CompanionState {
  if (!companion) throw new Error("the companion isn't loaded");
  return companion;
}

const freshState = (device: string): CompanionState => ({ v: 1, device, clock: null, scopes: {}, sends: [], acks: [], bookmarks: [], floors: {}, pulled: {} });

export function companionLoad(input: { device: string; state?: CompanionState | null; journal?: Record<string, LogFile[]> | null; fresh?: boolean }) {
  if (!input.state && !input.fresh) throw new Error("no saved state for this device");
  if (input.state && (input.state.v !== 1 || input.state.device !== input.device || !input.state.scopes || typeof input.state.scopes !== "object")) {
    throw new Error("the saved state belongs to another device or version");
  }
  const state = input.state ?? freshState(input.device);
  state.sends ??= [];
  state.acks ??= [];
  state.bookmarks ??= [];
  state.floors ??= {};
  state.pulled ??= {};
  state.scopes ??= {};
  const clock = new Clock(input.device, state.clock);
  let restored = false;
  for (const [scope, batches] of Object.entries(input.journal ?? {})) {
    const mine = (Array.isArray(batches) ? batches : []).filter((f) => f && f.device === input.device);
    if (!mine.length) continue;
    restoreJournal((state.scopes[scope] ??= emptyScope()), mine, clock, 0);
    restored = true;
  }
  if (restored) state.clock = clock.last;
  companion = state;
  savedJSON = "";
  savedPrint = "";
  viewJSON = "";
  return { device: state.device, scopes: Object.keys(state.scopes).length };
}

export function companionUnload() {
  companion = null;
  savedJSON = "";
  savedPrint = "";
  viewJSON = "";
  return true;
}

export function companionStateUnsaved() {
  savedJSON = "";
  savedPrint = "";
  return true;
}

function fingerprint(c: CompanionState): string {
  const scopes = Object.keys(c.scopes)
    .sort()
    .map((name) => {
      const s = c.scopes[name]!;
      return [name, s.seq, s.journal?.length ?? 0, s.outbox.length, Object.keys(s.files).length, s.pending, Object.keys(s.damaged).length, s.unapplied.length, s.joined, JSON.stringify(s.vv), JSON.stringify(s.extra), JSON.stringify(s.seen)].join("|");
    });
  return JSON.stringify([c.clock, scopes, c.sends, c.acks, c.bookmarks, c.floors, c.pulled]);
}

function save(force = false): boolean {
  const c = loaded();
  const print = fingerprint(c);
  if (!force && savedJSON && print === savedPrint) return true;
  const json = JSON.stringify(c);
  if (json === savedJSON) {
    savedPrint = print;
    return true;
  }
  const seqs = Object.fromEntries(Object.entries(c.scopes).map(([scope, s]) => [scope, s.seq]));
  if (host().saveState(json, JSON.stringify(seqs)) !== "ok") return false;
  savedJSON = json;
  savedPrint = print;
  return true;
}

const transport: Transport = {
  read: async (scope, known) => JSON.parse(host().read(scope, JSON.stringify(known))) as Listing,
  write: async (scope, payload) => host().write(scope, payload),
  remove: async (scope, ids) => {
    host().remove(scope, JSON.stringify(ids));
  },
};

const persistJournal =
  (scope: string) =>
  async (batches: LogFile[]): Promise<void> => {
    if (host().persistJournal(scope, JSON.stringify(batches.map((batch) => JSON.stringify(batch)))) !== "ok") throw new Error("couldn't save the sync journal");
  };

const scopeOptions = (scope: string, profile: boolean): ScopeOptions => ({
  persist: persistJournal(scope),
  compactAfterFiles: Infinity,
  ...(profile ? { expired: historyExpired } : {}),
});

function dropFrom<T extends { scope: string; key: string }>(list: T[], scope: string, keys: Set<string>): T[] {
  return keys.size ? list.filter((x) => x.scope !== scope || !keys.has(x.key)) : list;
}

function profileOf(app: ScopeState | undefined, profiles: Set<string>, fallback: string | null, p: string | null | undefined): string | null {
  if (p && profiles.has(p)) return p;
  return fallback;
}

export async function runCompanionCycle(input: CycleInput): Promise<CycleOutput> {
  const c = loaded();
  const now = () => input.now ?? Date.now();
  const empty = { received: [], historyRemoved: [], published: 0, changed: 0, pending: 0 };
  const status = host().chainStatus() as ChainStatus;
  if (status !== "ok") return { status, ...empty, saved: save(false) };
  const clock = new Clock(c.device, c.clock, now);
  const device = c.device;
  const retiring = !!input.retiring;
  let published = 0;
  let changed = 0;
  let pending = 0;
  const run = async (scope: string, adapters: Adapter[], profile: boolean) => {
    const state = (c.scopes[scope] ??= emptyScope());
    const result = await syncScope({ scope, state, transport, adapters, clock, device, now, options: scopeOptions(scope, profile) });
    state.unapplied = state.unapplied.filter((k) => adapters.some((a) => k.startsWith(a.prefix)));
    c.pulled[scope] = true;
    published += result.published;
    changed += result.changed;
    pending += result.pending;
    return state;
  };

  const app = await run(APP, [deviceAdapter(device, input.name, retiring)], false);
  const removals = new Map<string, Set<string>>();
  if (retiring) {
    for (const scope of Object.keys(c.scopes).filter((s) => s.startsWith("p:"))) await run(scope, [deviceTabsAdapter(device, input.name, [], true)], true);
  } else {
    const profiles = liveProfiles(app);
    const ids = new Set(profiles.keys());
    const fallback = defaultProfileId(profiles);
    const owner = new Map([...ids].map((id) => [id, dataOwner(app, id)]));
    const tabsOf = new Map<string, LocalTab[]>();
    for (const t of input.tabs ?? []) {
      const p = profileOf(app, ids, fallback, t.p);
      if (p) tabsOf.set(p, [...(tabsOf.get(p) ?? []), t]);
    }
    const visitsOf = new Map<string, (LocalVisit & { p: string })[]>();
    for (const v of input.visits ?? []) {
      const p = profileOf(app, ids, fallback, v.p);
      if (!p) continue;
      const o = owner.get(p) ?? p;
      visitsOf.set(o, [...(visitsOf.get(o) ?? []), { ...v, p }]);
    }
    for (const id of [...ids].sort()) {
      const scope = profileScope(id);
      const ownsData = owner.get(id) === id;
      const floors = (c.floors[scope] ??= {});
      for (const [url, at] of Object.entries(floors)) if (at < now() - HISTORY_WINDOW_MS) delete floors[url];
      let extracts = 0;
      const state = (c.scopes[scope] ??= emptyScope());
      const adapters: Adapter[] = [
        deviceTabsAdapter(device, input.name, input.tabs ? (tabsOf.get(id) ?? []) : null, false),
        sendsAdapter({
          scope,
          sends: () => c.sends,
          acks: () => c.acks,
          drop: (s, keys) => {
            c.sends = dropFrom(c.sends, s, keys);
            c.acks = dropFrom(c.acks, s, keys);
          },
        }),
        ...(ownsData
          ? [
              historyAdapter({
                visits: visitsOf.get(id) ?? [],
                profiles: [...ids].filter((p) => owner.get(p) === id).sort(),
                state,
                floors,
                removed: (p, url) => {
                  const set = removals.get(p) ?? new Set<string>();
                  set.add(url);
                  removals.set(p, set);
                },
                ready: () => !!input.visits && (!!c.pulled[scope] || ++extracts > 1),
              }),
              bookmarksAdapter({
                scope,
                state,
                ops: () => c.bookmarks,
                drop: (s, keys) => {
                  c.bookmarks = dropFrom(c.bookmarks, s, keys);
                },
              }),
            ]
          : []),
      ];
      await run(scope, adapters, true);
      if (!Object.keys(floors).length) delete c.floors[scope];
    }
  }
  c.clock = clock.last;

  const received: Received[] = [];
  if (!retiring) {
    const acked = new Set(c.acks.map((a) => `${a.scope}\n${a.key}`));
    const names = new Map([...visible(app, "dev:")].map(([k, v]) => [k.slice(4), typeof (v as { n?: unknown })?.n === "string" ? ((v as { n: string }).n as string) : null]));
    for (const id of liveProfiles(app).keys()) {
      const scope = profileScope(id);
      const state = c.scopes[scope];
      if (!state) continue;
      for (const [k, v] of visible(state, "send:")) {
        const s = v as SendValue;
        if (!s || s.to !== device || s.from === device || acked.has(`${scope}\n${k}`)) continue;
        if (typeof s.u !== "string" || !isWebUrl(s.u)) {
          c.acks.push({ scope, key: k });
          continue;
        }
        received.push({ profile: id, key: k, u: s.u, t: typeof s.t === "string" ? s.t : "", from: String(s.from ?? ""), fromName: names.get(String(s.from)) ?? null, at: Number(s.at) || 0 });
      }
    }
    received.sort((a, z) => a.at - z.at || (a.key < z.key ? -1 : 1));
  }

  const out: CycleOutput = {
    status,
    received,
    historyRemoved: [...removals].map(([profile, urls]) => ({ profile, urls: [...urls].sort() })),
    published,
    changed,
    pending,
    saved: save(published > 0 || changed > 0),
  };
  if (!retiring) {
    const view = buildView(c.scopes, device);
    const json = JSON.stringify(view);
    if (json !== viewJSON) {
      viewJSON = json;
      out.view = view;
    }
  }
  return out;
}

export function companionView(): View {
  const c = loaded();
  const view = buildView(c.scopes, c.device);
  viewJSON = JSON.stringify(view);
  return view;
}

const scopeFor = (profile: string) => profileScope(dataOwner(loaded().scopes[APP], profile));
const isLive = (profile: string) => liveProfiles(loaded().scopes[APP]).has(profile);
const refused = { saved: false, refused: true } as const;

export function companionSend(input: { profile: string; key: string; u: string; t: string; to: string; at: number }) {
  const c = loaded();
  if (!isLive(input.profile)) return refused;
  const key = `send:${input.key}`;
  if (!c.sends.some((s) => s.key === key)) {
    c.sends.push({ scope: profileScope(input.profile), key, value: { u: input.u, t: input.t, to: input.to, from: c.device, at: input.at } });
  }
  return { saved: save(true) };
}

export function companionAcknowledge(input: { items: { profile: string; key: string }[] }) {
  const c = loaded();
  for (const { profile, key } of input.items) {
    const scope = profileScope(profile);
    if (!c.acks.some((a) => a.scope === scope && a.key === key)) c.acks.push({ scope, key });
  }
  return { saved: save(true) };
}

export function companionAddBookmark(input: { profile: string; key: string; u: string; t: string; at: number }) {
  const c = loaded();
  if (!isLive(input.profile)) return refused;
  const scope = scopeFor(input.profile);
  if (!c.bookmarks.some((o) => o.scope === scope && o.key === input.key)) {
    c.bookmarks.push({ scope, op: "add", key: input.key, value: { k: "u", p: "other", t: input.t, u: input.u, a: input.at } });
  }
  return { saved: save(true) };
}

export function companionRemoveBookmark(input: { profile: string; key: string }) {
  const c = loaded();
  if (!isLive(input.profile)) return refused;
  const scope = scopeFor(input.profile);
  c.bookmarks = c.bookmarks.filter((o) => !(o.scope === scope && o.key === input.key));
  c.bookmarks.push({ scope, op: "remove", key: input.key });
  return { saved: save(true) };
}
