import type { LaunchConfig } from "../../../packages/shell/src/app";
import type { HydrateData } from "../../browser/src/state/browser/store";
import type { BrowserWindow, Tab } from "../../browser/src/state/browser/types";
import type { UnclaimedTab } from "./unclaimedTabs.ts";

export type HostListener = (module: string, event: string, payload: unknown) => void;
export type ArdiaHost = {
  bootstrap: {
    windowId: string;
    profileId: string;
    startup?: boolean;
    utility?: { pane: string; profileId: string | null; detail: string | null; importSource?: string };
    session?: HydrateData | null;
    documents?: Record<string, string>;
    nativeModules?: Record<string, Record<string, unknown>>;
    capabilities?: string[];
    launchConfig?: LaunchConfig;
    pageProfile?: string;
    privateWindow?: { window: BrowserWindow; tabs: Record<string, Tab> };
    typeaheadMs?: number;
    adoptTabs?: UnclaimedTab[];
    chromeMade?: boolean;
  };
  call(name: string, profile: string, args: string | null): Promise<string>;
  invoke(method: string, args: Record<string, unknown>): Promise<unknown>;
  onEvent(listener: HostListener): () => void;
  onBeforeClose?(listener: () => void): () => void;
};

declare global {
  interface Window {
    __ardiaHost?: ArdiaHost;
  }
}

export const ardiaHost = typeof window === "undefined" ? undefined : window.__ardiaHost;

export function hostProfile(profile: string | undefined, host: ArdiaHost = ardiaHost!) {
  return profile || host.bootstrap.profileId;
}

export function invokeHost<T = unknown>(method: string, args: Record<string, unknown>, host: ArdiaHost = ardiaHost!): Promise<T> {
  if (!host) return Promise.reject(new Error(`Ardia host unavailable: ${method}`));
  return Promise.resolve().then(() => host.invoke(method, args)) as Promise<T>;
}

export function hostSupports(method: string, host: ArdiaHost = ardiaHost!) {
  return !!host?.bootstrap.capabilities?.includes(method);
}

export function hostModuleMethod(module: string, method: string, host: ArdiaHost = ardiaHost!) {
  return (...args: unknown[]) => invokeHost(`${module}.${method}`, { args }, host);
}

export function callHost(name: string, profile: string, args: string | null, host: ArdiaHost = ardiaHost!) {
  if (!host) return Promise.reject(new Error(`Ardia host unavailable: ${name}`));
  if (typeof profile !== "string") return Promise.reject(Object.assign(new Error("Profile must be a string"), { code: "ERR_ENGINE" }));
  return Promise.resolve().then(() => host.call(name, hostProfile(profile, host), args)).then((reply) => {
    if (typeof reply !== "string") throw Object.assign(new Error("The engine reply is not JSON text"), { code: "ERR_BAD_REPLY" });
    let parsed: unknown;
    try { parsed = JSON.parse(reply); } catch { throw Object.assign(new Error("The engine reply is not JSON"), { code: "ERR_BAD_REPLY" }); }
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      throw Object.assign(new Error(String(parsed.error)), { code: "ERR_ENGINE" });
    }
    return reply;
  });
}

export function reportHostError(error: unknown) {
  console.error("[ardia host]", error);
}
