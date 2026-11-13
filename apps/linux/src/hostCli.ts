import type { CliInstallResult } from "../../../packages/shell/src/cli";
import { hostSupports, invokeHost, reportHostError, type ArdiaHost } from "./host.ts";

type CliCache = { version: string | null; refreshed: boolean };

const caches = new WeakMap<ArdiaHost, CliCache>();

const isVersion = (value: unknown): value is string | null => value === null || typeof value === "string";

function cliCache(host: ArdiaHost): CliCache {
  const known = caches.get(host);
  if (known) return known;
  const seeded = host.bootstrap.nativeModules?.ArdiaCli?.installedVersion;
  const cache: CliCache = { version: isVersion(seeded) ? seeded : null, refreshed: false };
  caches.set(host, cache);
  host.onEvent((module, event, payload) => {
    if (module !== "ArdiaCli" || event !== "onInstalledVersion") return;
    const version = (payload as { version?: unknown } | null)?.version;
    if (isVersion(version)) cache.version = version;
  });
  return cache;
}

function refresh(host: ArdiaHost, cache: CliCache) {
  if (cache.refreshed) return;
  cache.refreshed = true;
  void invokeHost<unknown>("ArdiaCli.installedVersion", { args: [] }, host).then((version) => {
    if (isVersion(version)) cache.version = version;
  }, reportHostError);
}

function installedVersion(host: ArdiaHost) {
  const cache = cliCache(host);
  refresh(host, cache);
  return () => cache.version;
}

function install(host: ArdiaHost) {
  const cache = cliCache(host);
  return async (): Promise<CliInstallResult> => {
    const result = await invokeHost<CliInstallResult>("ArdiaCli.install", { args: [] }, host);
    if (result && "installedVersion" in result && isVersion(result.installedVersion)) cache.version = result.installedVersion;
    return result;
  };
}

const sendOnly = (host: ArdiaHost, method: string) => (...args: unknown[]) => {
  void invokeHost(method, { args }, host).catch(reportHostError);
};

export function cliModuleMethod(host: ArdiaHost, name: string, method: string): unknown {
  if (!hostSupports(`${name}.${method}`, host)) return undefined;
  if (name === "ArdiaCli" && method === "installedVersion") return installedVersion(host);
  if (name === "ArdiaCli" && method === "install") return install(host);
  if (name === "ArdiaAutomation" && (method === "reply" || method === "broadcast")) return sendOnly(host, `${name}.${method}`);
  if (name === "ArdiaUserScripts" && method === "watch") return sendOnly(host, `${name}.${method}`);
  return undefined;
}
