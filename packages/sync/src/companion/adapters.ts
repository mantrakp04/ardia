import { assignPositions } from "../order.ts";
import { hlcWall } from "../hlc.ts";
import { visible, type Adapter, type ScopeState } from "../scope.ts";

export const DAY_MS = 86_400_000;
export const HISTORY_WINDOW_MS = 90 * DAY_MS;
export const SEND_LIFETIME_MS = 7 * DAY_MS;
export const MAX_DEVICE_TABS = 30;
export const MAX_VISIT_TIMES = 50;
const SAME_VISIT_MS = 1;

export type DeviceValue = { n: string; k?: string; f?: string[] };
export type DeviceTabsValue = { n: string; k?: string; tabs: { u: string; t: string }[] };
export type HistoryValue = { t: string; n: number; vt: number[] };
export type SendValue = { u: string; t: string; to: string; from: string; at: number };
export type BookmarkValue = { k: "u" | "f"; p: string; t: string; u?: string; a: number; pos: string };

export type LocalTab = { u: string; t: string; at: number; p?: string | null };
export type LocalVisit = { u: string; t: string; vt: number[]; p?: string | null };

export type PendingSend = { scope: string; key: string; value: SendValue };
export type Ack = { scope: string; key: string };
export type BookmarkOp =
  | { scope: string; op: "add"; key: string; value: Omit<BookmarkValue, "pos"> & { pos?: string } }
  | { scope: string; op: "remove"; key: string };

export const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

export const historyExpired = (key: string, value: unknown, now: number) =>
  key.startsWith("h:") && lastVisitOf(value as HistoryValue) < now - HISTORY_WINDOW_MS;

export const lastVisitOf = (v: HistoryValue | null | undefined) => (v && Array.isArray(v.vt) ? Math.max(0, ...v.vt) : 0);

export function deviceAdapter(device: string, name: string, retiring: boolean): Adapter {
  const key = `dev:${device}`;
  return {
    prefix: "dev:",
    extract: () => ({
      values: retiring ? new Map() : new Map([[key, { n: name, k: "phone", f: ["send"] } satisfies DeviceValue]]),
      ignore: (k) => k !== key,
    }),
    apply: () => true,
  };
}

export function deviceTabsAdapter(device: string, name: string, tabs: LocalTab[] | null, retiring: boolean): Adapter {
  const key = `tabs:${device}`;
  return {
    prefix: "tabs:",
    extract: () => {
      if (retiring) return { values: new Map(), ignore: (k) => k !== key };
      if (!tabs) return null;
      const recent = tabs
        .filter((t) => isWebUrl(t.u))
        .sort((a, z) => z.at - a.at)
        .slice(0, MAX_DEVICE_TABS)
        .map((t) => ({ u: t.u, t: t.t }));
      return { values: new Map([[key, { n: name, k: "phone", tabs: recent } satisfies DeviceTabsValue]]), ignore: (k) => k !== key };
    },
    apply: () => true,
  };
}

const near = (times: number[], t: number) => times.some((k) => Math.abs(k - t) <= SAME_VISIT_MS);

function unionTimes(a: number[], b: number[]): number[] {
  const out: number[] = [];
  for (const t of [...a, ...b].sort((x, y) => x - y)) if (!out.length || t - out[out.length - 1]! > SAME_VISIT_MS) out.push(t);
  return out.slice(-MAX_VISIT_TIMES);
}

export type HistoryContext = {
  visits: (LocalVisit & { p: string })[];
  profiles: string[];
  state: ScopeState;
  floors: Record<string, number>;
  removed: (profile: string, url: string) => void;
  ready: () => boolean;
};

export function historyAdapter(ctx: HistoryContext): Adapter {
  return {
    prefix: "h:",
    extract: (_base, _queued, now, _known, remote, stamp) => {
      if (!ctx.ready()) return null;
      const since = now - HISTORY_WINDOW_MS;
      const byUrl = new Map<string, { title: string; times: number[]; profiles: Set<string>; newest: number }>();
      for (const v of ctx.visits) {
        if (!isWebUrl(v.u) || !Array.isArray(v.vt)) continue;
        const entry = byUrl.get(v.u) ?? { title: "", times: [], profiles: new Set(), newest: 0 };
        const times = v.vt.filter((t) => Number.isFinite(t) && t >= since);
        if (!times.length) continue;
        entry.times.push(...times);
        entry.profiles.add(v.p);
        const newest = Math.max(...times);
        if (newest >= entry.newest) {
          entry.newest = newest;
          if (v.t) entry.title = v.t;
        }
        byUrl.set(v.u, entry);
      }
      const values = new Map<string, unknown>();
      for (const [url, entry] of byUrl) {
        const key = `h:${url}`;
        const known = remote(key) as HistoryValue | null | undefined;
        if (known === null) {
          const h = stamp(key);
          const deletedAt = h ? hlcWall(h) : 0;
          if (deletedAt > (ctx.floors[url] ?? -Infinity)) ctx.floors[url] = deletedAt;
        }
        const floor = ctx.floors[url] ?? -Infinity;
        const local = unionTimes([], entry.times.filter((t) => t > floor));
        if (!local.length) {
          for (const p of entry.profiles) ctx.removed(p, url);
          continue;
        }
        if (!known) {
          values.set(key, { t: entry.title, n: local.length, vt: local } satisfies HistoryValue);
          continue;
        }
        const knownTimes = Array.isArray(known.vt) ? known.vt.filter((t) => Number.isFinite(t)) : [];
        const oldestKept = knownTimes.length >= MAX_VISIT_TIMES ? Math.min(...knownTimes) : -Infinity;
        const missing = local.filter((t) => t >= oldestKept && !near(knownTimes, t));
        if (!missing.length) continue;
        const vt = unionTimes(knownTimes, local);
        values.set(key, {
          t: entry.title || (typeof known.t === "string" ? known.t : ""),
          n: Math.max(typeof known.n === "number" ? known.n : 0, local.length, vt.length),
          vt,
        } satisfies HistoryValue);
      }
      return { values, ignore: (k) => !values.has(k) };
    },
    editedAt: (v) => lastVisitOf(v as HistoryValue),
    apply: (visible, changed, _base, records) => {
      for (const key of changed) {
        if (visible.has(key)) continue;
        const url = key.slice(2);
        const tombstone = ctx.state.records[key];
        const deletedAt = tombstone ? hlcWall(tombstone.h) : records.now;
        if (deletedAt > (ctx.floors[url] ?? -Infinity)) ctx.floors[url] = deletedAt;
        for (const p of ctx.profiles) ctx.removed(p, url);
      }
      return true;
    },
  };
}

export type SendContext = {
  scope: string;
  sends: () => PendingSend[];
  acks: () => Ack[];
  drop: (scope: string, keys: Set<string>) => void;
};

export function sendsAdapter(ctx: SendContext): Adapter {
  return {
    prefix: "send:",
    extract: (_base, _queued, now, _known, remote) => {
      const values = new Map<string, unknown>();
      const tombstones = new Set<string>();
      const gone = new Set<string>();
      for (const s of ctx.sends()) {
        if (s.scope !== ctx.scope) continue;
        const record = remote(s.key);
        if (record === null) gone.add(s.key);
        else if (now - s.value.at >= SEND_LIFETIME_MS) {
          if (record === undefined) gone.add(s.key);
          else tombstones.add(s.key);
        } else values.set(s.key, s.value);
      }
      for (const a of ctx.acks()) {
        if (a.scope !== ctx.scope) continue;
        const record = remote(a.key);
        if (record === null || record === undefined) gone.add(a.key);
        else tombstones.add(a.key);
      }
      if (gone.size) ctx.drop(ctx.scope, gone);
      return {
        values,
        ignore: (k) => !tombstones.has(k),
        published: (keys) => ctx.drop(ctx.scope, new Set([...keys].filter((k) => tombstones.has(k)))),
      };
    },
    apply: () => true,
  };
}

export type BookmarkContext = {
  scope: string;
  state: ScopeState;
  ops: () => BookmarkOp[];
  drop: (scope: string, keys: Set<string>) => void;
};

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function bookmarksAdapter(ctx: BookmarkContext): Adapter {
  return {
    prefix: "bm:",
    extract: (base, _queued, _now, _known, remote) => {
      const ops = ctx.ops().filter((o) => o.scope === ctx.scope);
      if (!ops.length) return { values: new Map(), ignore: () => true };
      const view = visible(ctx.state, "bm:");
      const values = new Map<string, unknown>();
      const deletes = new Set<string>();
      const settled = new Set<string>();
      const children = new Map<string, string[]>();
      for (const [k, v] of view) {
        const parent = (v as BookmarkValue).p;
        if (typeof parent === "string") children.set(parent, [...(children.get(parent) ?? []), k.slice(3)]);
      }
      const otherPositions = [...view]
        .filter(([, v]) => (v as BookmarkValue).p === "other" && typeof (v as BookmarkValue).pos === "string")
        .map(([k, v]) => [(v as BookmarkValue).pos, k] as const)
        .sort((a, z) => (a[0] < z[0] ? -1 : a[0] > z[0] ? 1 : a[1] < z[1] ? -1 : 1))
        .map(([pos]) => pos as string | undefined);
      for (const o of ops) {
        const key = `bm:${o.key}`;
        if (o.op === "add") {
          if (o.value.pos === undefined) {
            o.value.pos = assignPositions([...otherPositions, undefined]).at(-1)!;
            otherPositions.push(o.value.pos);
          }
          const record = remote(key);
          if (record !== undefined && (record === null || sameValue(record, o.value))) {
            settled.add(o.key);
            continue;
          }
          values.set(key, o.value);
        } else {
          if (remote(key) === null || remote(key) === undefined || base(key) === undefined) {
            settled.add(o.key);
            continue;
          }
          const stack = [o.key];
          while (stack.length) {
            const at = stack.pop()!;
            if (deletes.has(`bm:${at}`)) continue;
            deletes.add(`bm:${at}`);
            stack.push(...(children.get(at) ?? []));
          }
        }
      }
      for (const k of deletes) values.delete(k);
      if (settled.size) ctx.drop(ctx.scope, settled);
      return {
        values,
        ignore: (k) => !values.has(k) && !deletes.has(k),
        published: (keys) => ctx.drop(ctx.scope, new Set([...keys].map((k) => k.slice(3)))),
      };
    },
    apply: () => true,
  };
}
