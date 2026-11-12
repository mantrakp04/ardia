import { serverEnv } from "./env";
import { emailKey, normalizedEmail, type JunkCounts } from "./testflight-signups";
import { signupStore, type JunkClearing, type Removal, type Scan } from "./testflight-store";

const FRESH_MS = 60_000;

export type TestflightSignup = { email: string; key: string; at: number; copies: number };
export type TestflightList =
  | { configured: false; hint: string }
  | { configured: true; readAt: number; signups: TestflightSignup[]; junk: JunkCounts; unreadable: number; scanned: number; capped: boolean; maxObjects: number; timedOut: boolean };
export type TestflightRemoval = Removal;
export type TestflightJunkClearing = JunkClearing;

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

function store() {
  const base = testflightBase();
  return base ? signupStore({ base, headers: testflightHeaders() }) : null;
}

let generation = 0;
let cache: { at: number; generation: number; data: Promise<Scan> } | null = null;

function forget() {
  generation++;
  cache = null;
}

function cachedScan(scan: () => Promise<Scan>, fresh: boolean): Promise<Scan> {
  if (!fresh && cache && cache.generation === generation && Date.now() - cache.at < FRESH_MS) return cache.data;
  const entry = { at: Date.now(), generation, data: scan() };
  cache = entry;
  entry.data.catch(() => {
    if (cache === entry) cache = null;
  });
  return entry.data;
}

async function changing<T>(change: (signups: NonNullable<ReturnType<typeof store>>) => Promise<T>): Promise<T> {
  const signups = store();
  if (!signups) throw new Error(NOT_CONFIGURED);
  forget();
  try {
    return await change(signups);
  } finally {
    forget();
  }
}

export async function listTestflightSignups(fresh = false): Promise<TestflightList> {
  const signups = store();
  if (!signups) return { configured: false, hint: NOT_CONFIGURED };
  const found = await cachedScan(signups.scan, fresh);
  return {
    configured: true,
    readAt: found.readAt,
    signups: found.signups.map((s) => ({ email: s.email, key: s.key, at: s.at, copies: s.objects.length })),
    junk: found.junk,
    unreadable: found.unreadable,
    scanned: found.scanned,
    capped: found.capped,
    maxObjects: signups.maxObjects,
    timedOut: found.timedOut,
  };
}

export async function removeTestflightSignup(email: string): Promise<TestflightRemoval> {
  const key = emailKey(email);
  if (!normalizedEmail(key) || key !== email) throw new Error("Not an email on the list");
  return changing((signups) => signups.remove(key));
}

export async function clearTestflightJunk(): Promise<TestflightJunkClearing> {
  return changing((signups) => signups.clearJunk());
}
