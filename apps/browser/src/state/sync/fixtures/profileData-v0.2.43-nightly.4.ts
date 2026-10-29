import { assignPositions, type Adapter } from "@ardia/sync";
import { addHistoryVisits, deleteHistoryUrls } from "../../../platform/history";
import { bookmarkUuidFor, isBookmarkUuid, rootIdsFor } from "../../bookmarks/bookmarks";
import { MAX_HISTORY, MAX_VISIT_TIMES } from "../../history/history";
import { useBrowser, type BrowserState } from "../../browser/store";
import { engineProfile } from "../../browser/model";
import type { BookmarkNode, HistoryEntry } from "../../browser/types";

type Bookmarks = { nodes: Record<string, BookmarkNode>; roots: Record<string, { bar: string; other: string }> };

export type ProfileDataState = {
  bookmarks: Bookmarks;
  bookmarksReady: Record<string, true>;
  history: Record<string, HistoryEntry[]>;
  historyReady: Record<string, true>;
  historyFloor: Record<string, number>;
};

const store = () => useBrowser.getState() as unknown as ProfileDataState;

function setStore(patch: Partial<ProfileDataState> | ((s: ProfileDataState) => Partial<ProfileDataState>)) {
  useBrowser.setState((s) => (typeof patch === "function" ? patch(s as unknown as ProfileDataState) : patch) as unknown as Partial<BrowserState>);
}

function ensureRoots(b: Bookmarks, profileId: string): [Bookmarks, { bar: string; other: string }] {
  const existing = b.roots[profileId];
  if (existing) return [b, existing];
  const roots = rootIdsFor(engineProfile(useBrowser.getState(), profileId));
  const nodes = { ...b.nodes };
  nodes[roots.bar] ??= { kind: "folder", id: roots.bar, parentId: null, title: "Bookmarks Bar", children: [], addedAt: 0 };
  nodes[roots.other] ??= { kind: "folder", id: roots.other, parentId: null, title: "Other Bookmarks", children: [], addedAt: 0 };
  return [{ nodes, roots: { ...b.roots, [profileId]: roots } }, roots];
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
      setStore({ bookmarks: { ...b, nodes } });
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
      const engine = engineProfile(useBrowser.getState(), profileId);
      await Promise.all([addHistoryVisits(engine, add, SAME_VISIT_MS), deleteHistoryUrls(engine, remove)]);
      setStore((s) => {
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
