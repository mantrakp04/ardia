import type { ConfigFileRead } from "../../../packages/shell/src/config";
import { THEME_NAME } from "../../browser/src/lib/themeFile";
import { hostSupports, invokeHost, reportHostError, type ArdiaHost } from "./host.ts";

const CONFIG_FILE = "config.json";
const FAILED_READS = new Set(["missing", "notFile", "tooBig", "unreadable"]);
const CONFIG_METHODS = ["ArdiaConfig.readFile", "ArdiaConfig.watch", "ArdiaConfig.writeSchemas"] as const;

type ConfigCache = { reads: Map<string, ConfigFileRead>; generation: number; changed: () => void };

const caches = new WeakMap<ArdiaHost, ConfigCache>();

export const hostReadsConfig = (host: ArdiaHost) => CONFIG_METHODS.every((method) => hostSupports(method, host));

function decoded(value: unknown): ConfigFileRead {
  const read = value as { status?: unknown; text?: unknown } | null;
  if (read?.status === "ok" && typeof read.text === "string") return { status: "ok", text: read.text };
  if (typeof read?.status === "string" && FAILED_READS.has(read.status)) return { status: read.status as Exclude<ConfigFileRead["status"], "ok"> };
  return { status: "unreadable" };
}

function themeNamed(read: ConfigFileRead): string | null {
  if (read.status !== "ok") return null;
  try {
    const theme = (JSON.parse(read.text) as { theme?: unknown } | null)?.theme;
    return typeof theme === "string" && THEME_NAME.test(theme) ? theme : null;
  } catch {
    return null;
  }
}

const fetchRead = (host: ArdiaHost, name: string) => invokeHost<unknown>("ArdiaConfig.readFile", { args: [name] }, host).then(decoded, (error: unknown) => {
  reportHostError(error);
  return { status: "unreadable" } as const;
});

async function refresh(host: ArdiaHost, cache: ConfigCache, extra: string[] = []): Promise<boolean> {
  const generation = ++cache.generation;
  const config = await fetchRead(host, CONFIG_FILE);
  const theme = themeNamed(config);
  const names = new Set([...cache.reads.keys(), ...extra, ...(theme ? [`themes/${theme}.json`] : [])]);
  names.delete(CONFIG_FILE);
  const reads = await Promise.all([...names].map(async (name) => [name, await fetchRead(host, name)] as const));
  if (generation !== cache.generation) return false;
  cache.reads.set(CONFIG_FILE, config);
  for (const [name, read] of reads) cache.reads.set(name, read);
  return true;
}

function refreshAndAnnounce(host: ArdiaHost, cache: ConfigCache, extra?: string[]) {
  void refresh(host, cache, extra).then((applied) => {
    if (applied) cache.changed();
  });
}

export async function startHostConfig(host: ArdiaHost, changed: () => void): Promise<void> {
  if (!hostReadsConfig(host) || caches.has(host)) return;
  const cache: ConfigCache = { reads: new Map(), generation: 0, changed };
  caches.set(host, cache);
  host.onEvent((module, event) => {
    if (module === "ArdiaConfig" && event === "onFilesChanged") refreshAndAnnounce(host, cache);
  });
  await refresh(host, cache);
}

function readFile(host: ArdiaHost) {
  return (name: string): ConfigFileRead => {
    const cache = caches.get(host);
    const known = cache?.reads.get(name);
    if (known) return known;
    if (cache) refreshAndAnnounce(host, cache, [name]);
    return { status: "missing" };
  };
}

export function configModuleMethod(host: ArdiaHost, name: string, method: string): unknown {
  if (name !== "ArdiaConfig" || !hostReadsConfig(host)) return undefined;
  if (method === "readFile") return readFile(host);
  if (method === "watch") return (names: string[]) => invokeHost<void>("ArdiaConfig.watch", { args: [names] }, host);
  if (method === "writeSchemas") return (files: Record<string, string>) => invokeHost<string[]>("ArdiaConfig.writeSchemas", { args: [files] }, host);
  return undefined;
}
