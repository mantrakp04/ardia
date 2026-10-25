export type DeveloperReload = "reload" | "forceReload";

export type DeveloperModeState = { on: string[]; off: string[]; reload: DeveloperReload };

export const NO_DEVELOPER_MODE: DeveloperModeState = { on: [], off: [], reload: "reload" };

const DEFAULT_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MAX_HOSTS = 1000;

export function developerHostOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase();
  return host ? host.replace(/^www\./, "") : null;
}

export function isDefaultDeveloperHost(host: string): boolean {
  const h = host.toLowerCase();
  return DEFAULT_HOSTS.has(h) || h.endsWith(".localhost");
}

export function isDeveloperMode(url: string, state: DeveloperModeState): boolean {
  const host = developerHostOf(url);
  if (!host) return false;
  return isDefaultDeveloperHost(host) ? !state.off.includes(host) : state.on.includes(host);
}

export function withDeveloperMode(state: DeveloperModeState, url: string, on: boolean): DeveloperModeState {
  const host = developerHostOf(url);
  if (!host) return state;
  const list = isDefaultDeveloperHost(host) ? "off" : "on";
  const listed = list === "on" ? on : !on;
  const rest = state[list].filter((h) => h !== host);
  return { ...state, [list]: listed ? [...rest, host].slice(-MAX_HOSTS) : rest };
}

const hostList = (value: unknown, keep: (host: string) => boolean): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((h): h is string => typeof h === "string" && h.length > 0 && h.length <= 253).map((h) => h.toLowerCase()))].filter(keep).slice(-MAX_HOSTS)
    : [];

export function developerModeOf(value: unknown): DeveloperModeState {
  if (!value || typeof value !== "object") return NO_DEVELOPER_MODE;
  const v = value as { on?: unknown; off?: unknown; reload?: unknown };
  return {
    on: hostList(v.on, (h) => !isDefaultDeveloperHost(h)),
    off: hostList(v.off, isDefaultDeveloperHost),
    reload: v.reload === "forceReload" ? "forceReload" : "reload",
  };
}

export const isEmptyDeveloperMode = (state: DeveloperModeState) => !state.on.length && !state.off.length && state.reload === "reload";
