import { hostLaunchConfig } from "./hostLaunchConfig.ts";
import { calendarModuleMethod } from "./hostCalendar.ts";
import type { ArdiaHost } from "./host";
import { callHost, hostModuleMethod, hostSupports } from "./host.ts";
import { linuxMediaCall } from "./hostCast.ts";
import { credentialModuleMethod } from "./hostCredentials.ts";
import { syncModuleMethod } from "./hostSync.ts";
import { linuxSystemMethod } from "./hostFiles.ts";
import { linuxModuleMethod } from "./hostSystem.ts";
import { linuxShellMethod } from "./shellMethods.ts";
import { appModuleFallback } from "./appModuleFallbacks.ts";

const synchronousDefaults: Record<string, Record<string, unknown>> = {
  ArdiaApp: { apiVersion: 0 },
  ArdiaTranslate: { available: false },
  ArdiaSystem: { backgroundInstance: false },
};

const synchronousMethods: Record<string, Record<string, unknown>> = {
  ArdiaGlassEffect: { isLiquidGlass: false },
  ArdiaCli: { installedVersion: null },
  ArdiaUserScripts: { watch: undefined },
};

const nativeFallthroughs = new WeakSet<object>();
export const reachesNativeHostUnchecked = (resolved: unknown) => typeof resolved === "function" && nativeFallthroughs.has(resolved);

export function resolveHostModule(host: ArdiaHost, name: string, method: string): unknown {
  if (name === "ArdiaApp" && method === "launchConfig") return () => hostLaunchConfig(host);
  if (name === "ArdiaShell" && !hostSupports(`${name}.${method}`, host)) {
    const local = linuxShellMethod(method);
    if (local) return local;
  }
  if (name === "ArdiaSystem") {
    const local = linuxSystemMethod(host, method);
    if (local !== undefined) return local;
  }
  const platform = linuxModuleMethod(host, name, method);
  if (platform) return platform;
  const credential = credentialModuleMethod(host, name, method);
  if (credential !== undefined) return credential;
  const syncMethod = syncModuleMethod(host, name, method);
  if (syncMethod !== undefined) return syncMethod;
  const calendar = calendarModuleMethod(host, name, method);
  if (calendar !== undefined) return calendar;
  const fallback = appModuleFallback(host, name, method);
  if (fallback) return fallback;
  if (name === "ArdiaDocuments" && method === "call") {
    return (verb: string, profile: string, args: string) => {
      if (!["watch", "commit", "flush", "unwatch"].includes(verb)) return Promise.reject(Object.assign(new Error("Unknown document operation"), { code: "ERR_UNKNOWN_CALL" }));
      if (typeof args !== "string") return Promise.reject(Object.assign(new Error("Document arguments require JSON text"), { code: "ERR_DOCUMENT_REQUEST" }));
      return callHost(`documents.${verb}`, profile, args, host);
    };
  }
  if (name === "ArdiaMedia" && method === "call") {
    return (verb: string, profile: string, args: string) => linuxMediaCall(verb, args) ?? callHost(`media.${verb}`, profile, args, host);
  }
  if (method === "call" && /^Ardia[A-Z]/.test(name)) {
    const domain = name.slice(5, 6).toLowerCase() + name.slice(6);
    return (verb: string, profile: string, args: string) => callHost(`${domain}.${verb}`, profile, args, host);
  }
  const constants = host.bootstrap.nativeModules?.[name];
  const sync = synchronousMethods[name];
  if (sync && method in sync) return () => constants?.[method] ?? sync[method];
  if (constants && method in constants) return constants[method];
  const defaults = synchronousDefaults[name];
  if (defaults && method in defaults) return defaults[method];
  const fallthrough = hostModuleMethod(name, method, host);
  nativeFallthroughs.add(fallthrough);
  return fallthrough;
}
