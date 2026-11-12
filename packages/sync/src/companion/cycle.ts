import { Clock } from "../hlc.ts";
import { syncScope, visible } from "../scope.ts";
import { emptyScope, type Adapter, type Listing, type LogFile, type ScopeOptions, type ScopeState, type Transport } from "../scopeState.ts";
import {
  bookmarksAdapter,
  deviceAdapter,
  deviceTabsAdapter,
  historyAdapter,
  historyExpired,
  HISTORY_WINDOW_MS,
  isWebUrl,
  sendsAdapter,
  SEND_LIFETIME_MS,
  DAY_MS,
  type LocalTab,
  type BookmarkValue,
  type LocalVisit,
  type SendRecord,
} from "./adapters.ts";
import { fromLegacyUrl } from "./legacy.ts";
import { buildView, dataOwner, defaultProfileId, liveProfiles, type View } from "./view.ts";
import { host, loaded, save, viewIsNew, type CompanionState } from "./state.ts";

export type ChainStatus = "ok" | "missing" | "unavailable";

export type CycleInput = {
  name: string;
  now?: number;
  retiring?: boolean;
  tabs?: LocalTab[] | null;
  visits?: LocalVisit[] | null;
  fetchedDue?: string[];
};

export type Received = { profile: string; key: string; u: string; t: string; from: string; fromName: string | null; at: number };
export type Removal = { profile: string; urls: string[]; unassigned: boolean };

export type CycleOutput = {
  status: ChainStatus;
  view?: View;
  received: Received[];
  historyRemoved: Removal[];
  visitsDue: string[];
  published: number;
  changed: number;
  pending: number;
  saved: boolean;
};

const APP = "app";
const GHOST_MS = 30 * 86_400_000;

function removalsOf(c: CompanionState): Removal[] {
  const fallback = defaultProfileId(liveProfiles(c.scopes[APP]));
  return Object.entries(c.removals ?? {})
    .filter(([, urls]) => urls.length)
    .sort(([a], [z]) => (a < z ? -1 : 1))
    .map(([profile, urls]) => ({ profile, urls: [...urls].sort(), unassigned: profile === fallback }));
}

const dueOf = (c: CompanionState) => [...new Set(Object.values(c.due ?? {}).flatMap((urls) => Object.keys(urls)))].sort();
const profileScope = (syncId: string) => `p:${syncId}`;

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
  const empty = { received: [], historyRemoved: removalsOf(c), visitsDue: dueOf(c), published: 0, changed: 0, pending: 0 };
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

  c.ghosts = (c.ghosts ?? []).filter((g) => now() - g.since < GHOST_MS);
  const ghosts = c.ghosts.map((g) => g.id);
  const app = await run(APP, [deviceAdapter(device, input.name, retiring, ghosts)], false);
  if (retiring) {
    for (const scope of Object.keys(c.scopes).filter((s) => s.startsWith("p:"))) await run(scope, [deviceTabsAdapter(device, input.name, [], true, ghosts)], true);
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
    const visited = (c.visited ??= {});
    for (const v of input.visits ?? []) {
      const p = profileOf(app, ids, fallback, v.p);
      if (!p || typeof v.u !== "string" || !Array.isArray(v.vt)) continue;
      const o = owner.get(p) ?? p;
      visitsOf.set(o, [...(visitsOf.get(o) ?? []), { ...v, p }]);
      const newest = Math.max(...v.vt.filter((t) => Number.isFinite(t)));
      const mine = (visited[profileScope(o)] ??= {});
      if (Number.isFinite(newest) && newest > (mine[v.u] ?? -Infinity)) mine[v.u] = newest;
    }
    for (const id of [...ids].sort()) {
      const scope = profileScope(id);
      const ownsData = owner.get(id) === id;
      const floors = (c.floors[scope] ??= {});
      for (const [url, at] of Object.entries(floors)) if (at < now() - HISTORY_WINDOW_MS) delete floors[url];
      const mine = (visited[scope] ??= {});
      for (const [url, at] of Object.entries(mine)) if (at < now() - HISTORY_WINDOW_MS) delete mine[url];
      let extracts = 0;
      const state = (c.scopes[scope] ??= emptyScope());
      const adapters: Adapter[] = [
        deviceTabsAdapter(device, input.name, input.tabs ? (tabsOf.get(id) ?? []) : null, false, ghosts),
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
                visited: mine,
                due: (url) => {
                  (c.due![scope] ??= {})[url] = true;
                },
                removed: (p, url) => {
                  const list = (c.removals![p] ??= []);
                  if (!list.includes(url)) list.push(url);
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
      if (!Object.keys(mine).length) delete visited[scope];
    }
    const fetched = new Set(input.fetchedDue ?? []);
    for (const [scope, urls] of Object.entries(c.due ?? {})) {
      for (const url of Object.keys(urls)) if (fetched.has(url) || !(url in (visited[scope] ?? {}))) delete urls[url];
      if (!Object.keys(urls).length) delete c.due![scope];
    }
  }
  c.clock = clock.last;
  forgetOldSends(c, now());

  const received: Received[] = [];
  if (!retiring) {
    const acked = new Set(c.acks.map((a) => `${a.scope}\n${a.key}`));
    const names = new Map([...visible(app, "dev:")].map(([k, v]) => [k.slice(4), typeof (v as { n?: unknown })?.n === "string" ? ((v as { n: string }).n as string) : null]));
    for (const id of liveProfiles(app).keys()) {
      const scope = profileScope(id);
      const state = c.scopes[scope];
      if (!state) continue;
      for (const [k, v] of visible(state, "send:")) {
        const s = v as SendRecord;
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
    historyRemoved: removalsOf(c),
    visitsDue: dueOf(c),
    published,
    changed,
    pending,
    saved: save(published > 0 || changed > 0),
  };
  if (!retiring) {
    const view = buildView(c.scopes, device);
    if (viewIsNew(JSON.stringify(view))) out.view = view;
  }
  return out;
}

export function companionView(): View {
  const c = loaded();
  const view = buildView(c.scopes, c.device);
  viewIsNew(JSON.stringify(view));
  return view;
}

const scopeFor = (profile: string) => profileScope(dataOwner(loaded().scopes[APP], profile));
const isLive = (profile: string) => liveProfiles(loaded().scopes[APP]).has(profile);
const refused = { saved: false, refused: true } as const;
const SEND_KEY_KEPT_MS = SEND_LIFETIME_MS + DAY_MS;

function forgetOldSends(c: CompanionState, now: number) {
  const sent = (c.sent ??= {});
  for (const [key, at] of Object.entries(sent)) if (now - at > SEND_KEY_KEPT_MS) delete sent[key];
  return sent;
}

export function companionSend(input: { profile: string; key: string; u: string; t: string; to: string; at: number }) {
  const c = loaded();
  if (!isLive(input.profile)) return refused;
  const key = `send:${input.key}`;
  const sent = forgetOldSends(c, input.at);
  const known = key in sent || c.sends.some((s) => s.key === key);
  sent[key] ??= input.at;
  if (!known) {
    c.sends.push({ scope: profileScope(input.profile), key, value: { u: input.u, t: input.t, to: input.to, from: c.device, at: input.at } });
  }
  return { saved: save(true) };
}

export function companionRemovalsDone(input: { items: { profile: string; urls: string[] }[] }) {
  const c = loaded();
  for (const { profile, urls } of input.items) {
    const left = (c.removals?.[profile] ?? []).filter((url) => !urls.includes(url));
    if (left.length) c.removals![profile] = left;
    else delete c.removals?.[profile];
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

function hasBookmarkFor(c: CompanionState, scope: string, url: string) {
  const removing = new Set(c.bookmarks.filter((o) => o.scope === scope && o.op === "remove").map((o) => `bm:${o.key}`));
  if (c.bookmarks.some((o) => o.scope === scope && o.op === "add" && o.value.u === url)) return true;
  const state = c.scopes[scope];
  if (!state) return false;
  for (const [key, value] of visible(state, "bm:")) {
    const bookmark = value as BookmarkValue | null;
    if (!removing.has(key) && bookmark?.k === "u" && typeof bookmark.u === "string" && fromLegacyUrl(bookmark.u) === url) return true;
  }
  return false;
}

export function companionAddBookmark(input: { profile: string; key: string; u: string; t: string; at: number }) {
  const c = loaded();
  if (!isLive(input.profile)) return refused;
  const scope = scopeFor(input.profile);
  if (hasBookmarkFor(c, scope, input.u)) return { saved: true, existing: true };
  if (!c.bookmarks.some((o) => o.scope === scope && o.key === input.key)) {
    c.bookmarks.push({ scope, op: "add", key: input.key, value: { k: "u", p: "other", t: input.t, u: input.u, a: input.at } });
  }
  return { saved: save(true), existing: false };
}

export function companionRemoveBookmark(input: { profile: string; key: string }) {
  const c = loaded();
  if (!isLive(input.profile)) return refused;
  const scope = scopeFor(input.profile);
  c.bookmarks = c.bookmarks.filter((o) => !(o.scope === scope && o.key === input.key));
  c.bookmarks.push({ scope, op: "remove", key: input.key });
  return { saved: save(true) };
}
