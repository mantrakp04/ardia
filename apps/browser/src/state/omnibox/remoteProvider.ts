import { fillProviderTemplate, parseProviderReply, PROVIDER_LIMITS, remoteRequestAllowed, type ProviderRowInput } from "@ardia/core";
import { isTestInstance } from "../../platform/launchConfig";

export const REMOTE_PROVIDER = { debounceMs: 120, maxBytes: 131_072, maxInFlight: 4, cacheSize: 64, cacheMs: 300_000, maxQuery: 512 } as const;

type Cached = { at: number; rows: ProviderRowInput[] };

const cache = new Map<string, Cached>();
let inFlight = 0;

const allowLoopback = () => isTestInstance();

const abortable = (ms: number, signal: AbortSignal) =>
  new Promise<boolean>((resolve) => {
    if (signal.aborted) return resolve(false);
    const timer = setTimeout(() => resolve(!signal.aborted), ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve(false);
    }, { once: true });
  });

function cached(key: string): ProviderRowInput[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > REMOTE_PROVIDER.cacheMs) {
    cache.delete(key);
    return null;
  }
  return hit.rows;
}

function remember(key: string, rows: ProviderRowInput[]) {
  cache.delete(key);
  cache.set(key, { at: Date.now(), rows });
  if (cache.size > REMOTE_PROVIDER.cacheSize) cache.delete(cache.keys().next().value!);
}

export const forgetRemoteProviderCache = () => cache.clear();

export async function fetchRemoteRows(template: string, text: string, partition: string, signal: AbortSignal, linkTemplate?: string): Promise<ProviderRowInput[]> {
  if (text.length > REMOTE_PROVIDER.maxQuery) return [];
  const url = fillProviderTemplate(template, text);
  if (!url || !remoteRequestAllowed(url, { allowLoopback: allowLoopback() })) return [];
  const key = `${partition}\n${url}\n${linkTemplate ?? ""}`;
  const hit = cached(key);
  if (hit) return hit;
  if (!(await abortable(REMOTE_PROVIDER.debounceMs, signal))) return [];
  if (inFlight >= REMOTE_PROVIDER.maxInFlight) return [];
  inFlight++;
  try {
    const res = await fetch(url, {
      signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (!res.ok || (res.url && !remoteRequestAllowed(res.url, { allowLoopback: allowLoopback() }))) return [];
    if (Number(res.headers.get("content-length") ?? 0) > REMOTE_PROVIDER.maxBytes) return [];
    const body = await res.text();
    if (body.length > REMOTE_PROVIDER.maxBytes || signal.aborted) return [];
    const rows = parseProviderReply(JSON.parse(body), linkTemplate).slice(0, PROVIDER_LIMITS.rowsPerProvider);
    remember(key, rows);
    return rows;
  } catch {
    return [];
  } finally {
    inFlight--;
  }
}
