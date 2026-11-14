import { serverEnv } from "./env";
import { paramSearch } from "./query-params";

const FRESH_MS = 5 * 60_000;
const KEEP_MS = 6 * 60 * 60_000;
const MAX_IN_FLIGHT = 2;
const MAX_CACHE_ENTRIES = 300;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const SETTINGS = {
  max_execution_time: "15",
  cancel_http_readonly_queries_on_client_close: "1",
  max_memory_usage: "500000000",
  do_not_merge_across_partitions_select_final: "1",
  output_format_json_quote_64bit_integers: "0",
};

type Rows = unknown[][];

export type CachePolicy = { freshMs: number; keepMs: number };

const DEFAULT_POLICY: CachePolicy = { freshMs: FRESH_MS, keepMs: KEEP_MS };

type Entry = { at: number; rows: Rows; bytes: number; policy: CachePolicy };

export type QueryParams = Record<string, string | number>;

type Job = {
  key: string;
  sql: string;
  params: QueryParams;
  policy: CachePolicy;
  label: string;
  waiters: number;
  controller: AbortController;
  started: boolean;
  promise: Promise<Rows>;
  resolve: (rows: Rows) => void;
  reject: (error: unknown) => void;
};

const cache = new Map<string, Entry>();
let cacheBytes = 0;
const inFlight = new Map<string, Job>();
const queue: Job[] = [];
let running = 0;

function endpoint(params: QueryParams) {
  const base = serverEnv("CLICKHOUSE_URL") ?? (serverEnv("CLICKHOUSE_HOST") ? `http://${serverEnv("CLICKHOUSE_HOST")}:8123/` : null);
  if (!base) throw new Error("ClickHouse is not configured: set CLICKHOUSE_URL or CLICKHOUSE_HOST");
  const url = new URL(base);
  for (const [key, value] of Object.entries(SETTINGS)) url.searchParams.set(key, value);
  for (const [name, value] of paramSearch(params)) url.searchParams.set(name, value);
  return url;
}

async function execute(job: Job): Promise<Rows> {
  const user = serverEnv("CLICKHOUSE_USER");
  const password = serverEnv("CLICKHOUSE_PASSWORD");
  if (!user || !password) throw new Error("ClickHouse credentials are not configured");
  const timeout = AbortSignal.timeout(20_000);
  const started = performance.now();
  const res = await fetch(endpoint(job.params), {
    method: "POST",
    headers: { "X-ClickHouse-User": user, "X-ClickHouse-Key": password, "Content-Type": "text/plain" },
    body: `${job.sql}\nFORMAT JSONCompact`,
    signal: AbortSignal.any([job.controller.signal, timeout]),
  });
  if (!res.ok) {
    const text = await res.text();
    if (/^\s*</.test(text)) throw new Error(`ClickHouse is unavailable right now (HTTP ${res.status}).`);
    const code = /Code: (\d+)/.exec(text)?.[1];
    if (code === "159") throw new Error("ClickHouse took longer than 15 s on this, so it was stopped. It will be retried.");
    throw new Error(`ClickHouse ${res.status}: ${text.slice(0, 240).replace(/\s+/g, " ")}`);
  }
  const body = (await res.json()) as { data: Rows; statistics?: { elapsed?: number; rows_read?: number; bytes_read?: number } };
  const stats = body.statistics;
  console.log(
    `[clickhouse] ${Math.round(performance.now() - started)} ms total, ${Math.round((stats?.elapsed ?? 0) * 1000)} ms server, ${stats?.rows_read ?? "?"} rows read, ${body.data.length} rows, ${job.label}`,
  );
  return body.data;
}

function pump() {
  while (running < MAX_IN_FLIGHT && queue.length) {
    const job = queue.shift()!;
    if (job.waiters <= 0) {
      if (inFlight.get(job.key) === job) inFlight.delete(job.key);
      job.reject(new DOMException("Aborted", "AbortError"));
      continue;
    }
    running++;
    job.started = true;
    execute(job)
      .then((rows) => {
        remember(job.key, rows, job.policy);
        job.resolve(rows);
      }, job.reject)
      .finally(() => {
        running--;
        if (inFlight.get(job.key) === job) inFlight.delete(job.key);
        pump();
      });
  }
}

function forget(sql: string) {
  const entry = cache.get(sql);
  if (!entry) return;
  cacheBytes -= entry.bytes;
  cache.delete(sql);
}

function remember(sql: string, rows: Rows, policy: CachePolicy) {
  forget(sql);
  const bytes = JSON.stringify(rows).length * 2 + sql.length * 2;
  if (bytes > MAX_CACHE_BYTES / 4) return;
  cache.set(sql, { at: Date.now(), rows, bytes, policy });
  cacheBytes += bytes;
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (cache.size <= MAX_CACHE_ENTRIES && cacheBytes <= MAX_CACHE_BYTES && now - entry.at < entry.policy.keepMs) break;
    forget(key);
  }
}

function refreshInBackground(key: string, sql: string, params: QueryParams, policy: CachePolicy) {
  if (inFlight.has(key)) return;
  run(key, sql, params, new AbortController().signal, policy).catch(() => undefined);
}

export function query(sql: string, signal?: AbortSignal, policy: CachePolicy = DEFAULT_POLICY, params: QueryParams = {}): Promise<Rows> {
  const key = Object.keys(params).length ? `${sql}\n${JSON.stringify(params)}` : sql;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < hit.policy.keepMs) {
    cache.delete(key);
    cache.set(key, hit);
    if (now - hit.at >= hit.policy.freshMs) refreshInBackground(key, sql, params, policy);
    return Promise.resolve(hit.rows);
  }
  if (hit) forget(key);
  return run(key, sql, params, signal, policy);
}

function run(key: string, sql: string, params: QueryParams, signal: AbortSignal | undefined, policy: CachePolicy): Promise<Rows> {
  let job = inFlight.get(key);
  if (!job) {
    let resolve!: (rows: Rows) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<Rows>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    promise.catch(() => undefined);
    job = { key, sql, params, policy, label: sql.replace(/\s+/g, " ").trim().slice(0, 70), waiters: 0, controller: new AbortController(), started: false, promise, resolve, reject };
    inFlight.set(key, job);
    queue.push(job);
  }
  const current = job;
  current.waiters++;

  return new Promise<Rows>((resolve, reject) => {
    let settled = false;
    const leave = () => {
      if (settled) return;
      settled = true;
      current.waiters--;
      if (current.waiters <= 0 && current.started) {
        if (inFlight.get(current.key) === current) inFlight.delete(current.key);
        current.controller.abort();
      }
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) return leave();
    signal?.addEventListener("abort", leave, { once: true });
    current.promise.then(
      (rows) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", leave);
        resolve(rows);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", leave);
        reject(error);
      },
    );
    pump();
  });
}


export const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

export const str = (value: unknown): string => (value == null ? "" : String(value));
