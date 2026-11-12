import { readCapped, TooLarge } from "./capped-read.ts";
import { buildSignupList, listedObjects, MAX_SIGNUP_BYTES, SIGNUP_OBJECT, sizeJunk, type ListedObject, type ReadObject, type SignupList } from "./testflight-signups.ts";

const PAGE_SIZE = 1000;
const MAX_LISTING_BYTES = 8 * 1024 * 1024;
const CONCURRENCY = 16;

export type StoreOptions = {
  base: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  maxObjects?: number;
  fetchTimeoutMs?: number;
  deadlineMs?: number;
};
export type Scan = SignupList & { readAt: number; capped: boolean; timedOut: boolean; complete: boolean };
export type Removal = { found: boolean; removed: number; failed: number; complete: boolean };
export type JunkClearing = { found: number; removed: number; failed: number; complete: boolean };

export function signupStore({ base, headers = {}, fetch: send = fetch, maxObjects = 20_000, fetchTimeoutMs = 10_000, deadlineMs = 45_000 }: StoreOptions) {
  async function call(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    try {
      return await send(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(fetchTimeoutMs)]) });
    } catch (error) {
      if (signal.aborted) throw new Error("Reading the TestFlight list took too long and was stopped.");
      const cause = (error as { cause?: { code?: string; message?: string } }).cause;
      throw new Error(`TestFlight storage unreachable (${cause?.code ?? cause?.message ?? (error as Error).message})`);
    }
  }

  async function listAll(signal: AbortSignal): Promise<{ objects: ListedObject[]; capped: boolean }> {
    const objects: ListedObject[] = [];
    let seen = 0;
    let after = "";
    for (;;) {
      const res = await call(`${base}?limit=${PAGE_SIZE}${after ? `&lastFileName=${encodeURIComponent(after)}` : ""}`, { headers: { ...headers, Accept: "application/json" } }, signal);
      if (res.status === 404) {
        await res.body?.cancel();
        return { objects, capped: false };
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`TestFlight storage: ${res.status}`);
      }
      let page: { Entries?: unknown; LastFileName?: unknown; ShouldDisplayLoadMore?: unknown };
      try {
        page = JSON.parse((await readCapped(res, MAX_LISTING_BYTES)).toString("utf8")) ?? {};
      } catch (error) {
        throw new Error(error instanceof TooLarge ? "TestFlight storage sent a listing that is too large" : "TestFlight storage sent a listing that is not JSON");
      }
      const entries = Array.isArray(page.Entries) ? page.Entries : [];
      seen += entries.length;
      objects.push(...listedObjects(entries));
      const next = typeof page.LastFileName === "string" ? page.LastFileName : "";
      if (page.ShouldDisplayLoadMore !== true) return { objects, capped: false };
      if (!entries.length || !next || next === after) throw new Error("TestFlight storage says there are more posts but gives no way to read on");
      if (seen >= maxObjects) return { objects, capped: true };
      after = next;
    }
  }

  async function readBodies(listed: ListedObject[], signal: AbortSignal): Promise<ReadObject[]> {
    const objects: ReadObject[] = listed.map((o) => ({ ...o }));
    const gone = new Set<ReadObject>();
    const todo = objects.filter((o) => !sizeJunk(o));
    const decoder = new TextDecoder();
    let next = 0;
    const worker = async () => {
      while (next < todo.length && !signal.aborted) {
        const object = todo[next++]!;
        try {
          const res = await call(`${base}${object.name}`, { headers }, signal);
          if (res.status === 404) {
            await res.body?.cancel();
            gone.add(object);
          } else if (!res.ok) {
            await res.body?.cancel();
            object.body = null;
          } else {
            object.body = decoder.decode(await readCapped(res, MAX_SIGNUP_BYTES));
          }
        } catch (error) {
          if (error instanceof TooLarge) object.size = MAX_SIGNUP_BYTES + 1;
          else object.body = null;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
    return objects.filter((o) => !gone.has(o));
  }

  async function scan(): Promise<Scan> {
    const deadline = AbortSignal.timeout(deadlineMs);
    const { objects, capped } = await listAll(deadline);
    const list = buildSignupList(await readBodies(objects, deadline));
    const timedOut = deadline.aborted;
    return { ...list, readAt: Date.now(), capped, timedOut, complete: !capped && !timedOut && list.unreadable === 0 };
  }

  async function deleteObjects(names: string[]): Promise<{ removed: number; failed: number }> {
    const todo = names.filter((name) => SIGNUP_OBJECT.test(name));
    const deadline = AbortSignal.timeout(deadlineMs);
    let removed = 0;
    let next = 0;
    const worker = async () => {
      while (next < todo.length && !deadline.aborted) {
        const name = todo[next++]!;
        try {
          const res = await call(`${base}${name}`, { method: "DELETE", headers }, deadline);
          await res.body?.cancel();
          if (res.ok || res.status === 404) removed++;
        } catch {
          continue;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
    return { removed, failed: todo.length - removed };
  }

  async function remove(key: string): Promise<Removal> {
    const found = await scan();
    const target = found.signups.find((s) => s.key === key);
    if (!target) return { found: false, removed: 0, failed: 0, complete: found.complete };
    return { found: true, ...(await deleteObjects(target.objects)), complete: found.complete };
  }

  async function clearJunk(): Promise<JunkClearing> {
    const found = await scan();
    return { found: found.junkObjects.length, ...(await deleteObjects(found.junkObjects)), complete: found.complete };
  }

  return { scan, remove, clearJunk, maxObjects };
}
