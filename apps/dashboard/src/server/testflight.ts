import { serverEnv } from "./env";
import { readCapped, TooLarge } from "./replays";
import { buildSignupList, emailKey, listedObjects, MAX_SIGNUP_BYTES, normalizedEmail, SIGNUP_OBJECT, sizeJunk, type JunkCounts, type ListedObject, type ReadObject } from "./testflight-signups";

const MAX_OBJECTS = 20_000;
const PAGE_SIZE = 1000;
const MAX_LISTING_BYTES = 8 * 1024 * 1024;
const CONCURRENCY = 16;
const FETCH_TIMEOUT_MS = 10_000;
const DEADLINE_MS = 45_000;
const FRESH_MS = 60_000;

export type TestflightSignup = { email: string; key: string; at: number; copies: number };
export type TestflightList =
  | { configured: false; hint: string }
  | { configured: true; readAt: number; signups: TestflightSignup[]; junk: JunkCounts; unreadable: number; scanned: number; capped: boolean; maxObjects: number; timedOut: boolean };
export type TestflightRemoval = { found: boolean; removed: number; failed: number; unreadable: number };

const NOT_CONFIGURED = "Set TESTFLIGHT_SIGNUPS_URL, or REPLAYS_URL / REPLAYS_HOST, to read the TestFlight list.";

export function testflightBase(): string | null {
  const explicit = serverEnv("TESTFLIGHT_SIGNUPS_URL");
  if (explicit) return explicit.endsWith("/") ? explicit : `${explicit}/`;
  const replays = serverEnv("REPLAYS_URL");
  if (replays && /\/buckets\/replays\/?$/.test(replays)) return replays.replace(/\/buckets\/replays\/?$/, "/buckets/testflight/");
  const host = serverEnv("REPLAYS_HOST");
  return host ? `http://${host}:8888/buckets/testflight/` : null;
}

function testflightHeaders(): Record<string, string> {
  const token = serverEnv("TESTFLIGHT_SIGNUPS_URL") ? serverEnv("TESTFLIGHT_SIGNUPS_TOKEN") : serverEnv("TESTFLIGHT_SIGNUPS_TOKEN") ?? serverEnv("REPLAYS_TOKEN");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

type Loaded = ReturnType<typeof buildSignupList> & { readAt: number; capped: boolean; timedOut: boolean };

async function call(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) });
  } catch (error) {
    if (signal.aborted) throw new Error("Reading the TestFlight list took too long and was stopped.");
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    throw new Error(`TestFlight storage unreachable (${cause?.code ?? cause?.message ?? (error as Error).message})`);
  }
}

async function listAll(base: string, headers: Record<string, string>, signal: AbortSignal): Promise<{ objects: ListedObject[]; capped: boolean }> {
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
    if (page.ShouldDisplayLoadMore !== true || !entries.length || !next || next === after) return { objects, capped: false };
    if (seen >= MAX_OBJECTS) return { objects, capped: true };
    after = next;
  }
}

async function readBodies(base: string, headers: Record<string, string>, listed: ListedObject[], signal: AbortSignal): Promise<ReadObject[]> {
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

async function readSignups(base: string): Promise<Loaded> {
  const headers = testflightHeaders();
  const deadline = AbortSignal.timeout(DEADLINE_MS);
  const { objects, capped } = await listAll(base, headers, deadline);
  const read = await readBodies(base, headers, objects, deadline);
  return { ...buildSignupList(read), readAt: Date.now(), capped, timedOut: deadline.aborted };
}

let generation = 0;
let cache: { at: number; generation: number; data: Promise<Loaded> } | null = null;

function cachedSignups(base: string, fresh: boolean): Promise<Loaded> {
  if (!fresh && cache && cache.generation === generation && Date.now() - cache.at < FRESH_MS) return cache.data;
  const entry = { at: Date.now(), generation, data: readSignups(base) };
  cache = entry;
  entry.data.catch(() => {
    if (cache === entry) cache = null;
  });
  return entry.data;
}

export async function listTestflightSignups(fresh = false): Promise<TestflightList> {
  const base = testflightBase();
  if (!base) return { configured: false, hint: NOT_CONFIGURED };
  const loaded = await cachedSignups(base, fresh);
  return {
    configured: true,
    readAt: loaded.readAt,
    signups: loaded.signups.map((s) => ({ email: s.email, key: s.key, at: s.at, copies: s.objects.length })),
    junk: loaded.junk,
    unreadable: loaded.unreadable,
    scanned: loaded.scanned,
    capped: loaded.capped,
    maxObjects: MAX_OBJECTS,
    timedOut: loaded.timedOut,
  };
}

export async function removeTestflightSignup(email: string): Promise<TestflightRemoval> {
  const key = emailKey(email);
  if (!normalizedEmail(key) || key !== email) throw new Error("Not an email on the list");
  const base = testflightBase();
  if (!base) throw new Error(NOT_CONFIGURED);
  generation++;
  cache = null;
  try {
    const loaded = await readSignups(base);
    const target = loaded.signups.find((s) => s.key === key);
    if (!target) return { found: false, removed: 0, failed: 0, unreadable: loaded.unreadable };
    const headers = testflightHeaders();
    const deadline = AbortSignal.timeout(DEADLINE_MS);
    let removed = 0;
    let failed = 0;
    for (const name of target.objects) {
      if (!SIGNUP_OBJECT.test(name)) continue;
      try {
        const res = await call(`${base}${name}`, { method: "DELETE", headers }, deadline);
        await res.body?.cancel();
        if (res.ok || res.status === 404) removed++;
        else failed++;
      } catch {
        failed++;
      }
    }
    return { found: true, removed, failed, unreadable: loaded.unreadable };
  } finally {
    generation++;
    cache = null;
  }
}
