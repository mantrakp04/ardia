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

type Received = { status: number; url: string; body: string };

export function cappedRequest(url: string, signal: AbortSignal, maxBytes: number): Promise<Received | null> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    let done = false;
    const finish = (value: Received | null) => {
      if (done) return;
      done = true;
      signal.removeEventListener("abort", stop);
      resolve(value);
    };
    const stop = () => {
      finish(null);
      xhr.abort();
    };
    const tooBig = (loaded: number) => loaded > maxBytes || (xhr.responseText?.length ?? 0) > maxBytes;
    xhr.open("GET", url, true);
    xhr.withCredentials = false;
    xhr.responseType = "text";
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("Cache-Control", "no-store");
    xhr.onreadystatechange = () => {
      if (xhr.readyState >= 2 && Number(xhr.getResponseHeader("content-length") ?? 0) > maxBytes) stop();
    };
    xhr.onprogress = (event: ProgressEvent) => {
      if (tooBig(event.loaded ?? 0)) stop();
    };
    xhr.onload = () => (tooBig(0) ? stop() : finish({ status: xhr.status, url: xhr.responseURL ?? "", body: xhr.responseText ?? "" }));
    xhr.onerror = () => finish(null);
    xhr.ontimeout = () => finish(null);
    xhr.onabort = () => finish(null);
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) return finish(null);
    xhr.send();
  });
}

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
    const res = await cappedRequest(url, signal, REMOTE_PROVIDER.maxBytes);
    if (!res || res.status < 200 || res.status > 299 || (res.url && !remoteRequestAllowed(res.url, { allowLoopback: allowLoopback() }))) return [];
    if (signal.aborted) return [];
    const rows = parseProviderReply(JSON.parse(res.body), linkTemplate).slice(0, PROVIDER_LIMITS.rowsPerProvider);
    remember(key, rows);
    return rows;
  } catch {
    return [];
  } finally {
    inFlight--;
  }
}
