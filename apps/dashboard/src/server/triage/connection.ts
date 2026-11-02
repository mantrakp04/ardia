import { serverEnv } from "../env";

const SETTINGS = {
  max_execution_time: "15",
  max_memory_usage: "500000000",
  output_format_json_quote_64bit_integers: "0",
  join_use_nulls: "1",
};

export type Row = Record<string, unknown>;

export class TriageNotConfigured extends Error {}

class UserBusy extends Error {}

function baseUrl() {
  const base =
    serverEnv("TRIAGE_CLICKHOUSE_URL") ??
    serverEnv("CLICKHOUSE_URL") ??
    (serverEnv("CLICKHOUSE_HOST") ? `http://${serverEnv("CLICKHOUSE_HOST")}:8123/` : null);
  if (!base) throw new TriageNotConfigured("ClickHouse is not configured: set TRIAGE_CLICKHOUSE_URL, CLICKHOUSE_URL or CLICKHOUSE_HOST");
  return base;
}

export function triageDatabase() {
  const name = serverEnv("TRIAGE_CLICKHOUSE_DATABASE") ?? "sandbox";
  if (!/^\w+$/.test(name)) throw new TriageNotConfigured("TRIAGE_CLICKHOUSE_DATABASE must be a plain identifier");
  return name;
}

function credentials() {
  const user = serverEnv("TRIAGE_CLICKHOUSE_USER") ?? "sandbox";
  const password = serverEnv("TRIAGE_CLICKHOUSE_PASSWORD");
  if (!password) throw new TriageNotConfigured("Triage needs TRIAGE_CLICKHOUSE_PASSWORD (Hexclave secret DASHBOARD_TRIAGE_CLICKHOUSE_PASSWORD) for the sandbox ClickHouse user");
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

const MAX_IN_FLIGHT = 1;
const BUSY_RETRIES = 5;
let running = 0;
const waiting: (() => void)[] = [];

async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await work();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function send(sql: string, signal?: AbortSignal): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await slot(() => sendOnce(sql, signal));
    } catch (error) {
      if (!(error instanceof UserBusy) || attempt >= BUSY_RETRIES || signal?.aborted) throw error;
      await pause(250 * (attempt + 1));
    }
  }
}

async function sendOnce(sql: string, signal?: AbortSignal): Promise<string> {
  const url = new URL(baseUrl());
  url.searchParams.set("database", triageDatabase());
  for (const [key, value] of Object.entries(SETTINGS)) url.searchParams.set(key, value);
  const started = performance.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: credentials(), "Content-Type": "text/plain" },
    body: sql,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) {
    if (/Code: 202\b/.test(text)) throw new UserBusy("ClickHouse is busy with other sandbox queries; try again in a moment.");
    if (/^\s*</.test(text)) throw new Error(`ClickHouse is unavailable right now (HTTP ${res.status}).`);
    throw new Error(`ClickHouse ${res.status}: ${text.slice(0, 240).replace(/\s+/g, " ")}`);
  }
  console.log(`[triage] ${Math.round(performance.now() - started)} ms, ${sql.replace(/\s+/g, " ").trim().slice(0, 70)}`);
  return text;
}

export async function triageRows(sql: string, signal?: AbortSignal): Promise<Row[]> {
  const text = await send(`${sql}\nFORMAT JSON`, signal);
  return (JSON.parse(text) as { data: Row[] }).data;
}

export async function triageExec(sql: string, signal?: AbortSignal): Promise<void> {
  await send(sql, signal);
}

export const sqlString = (value: string) => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export const text = (value: unknown): string | null => (value == null || value === "" ? null : String(value));

export const count = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

export const time = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const ms = Date.parse(`${String(value).replace(" ", "T")}Z`);
  return Number.isFinite(ms) ? ms : null;
};

export const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);
