import { hostSupports, type ArdiaHost } from "./host.ts";
import { linuxCapabilities, unavailableError } from "./hostCapabilities.ts";

const INTRO_MUSIC = new Set(["playIntroMusic", "setIntroMusicMuted", "stopIntroMusic"]);

export function linuxModuleMethod(host: ArdiaHost, name: string, method: string): ((...args: unknown[]) => Promise<unknown>) | undefined {
  if (name === "ArdiaSystem") return linuxSystemMethod(host, method);
  if (name !== "ArdiaApp" || hostSupports(`${name}.${method}`, host)) return undefined;
  if (INTRO_MUSIC.has(method)) return () => Promise.resolve();
  if (method === "openExternalURL") return () => Promise.resolve(false);
  return undefined;
}

function linuxSystemMethod(host: ArdiaHost, method: string): ((...args: unknown[]) => Promise<unknown>) | undefined {
  const capabilities = linuxCapabilities(host);
  switch (method) {
    case "isDefaultBrowser":
    case "setAsDefaultBrowser":
      return capabilities.defaultBrowser ? undefined : () => Promise.reject(unavailableError("Setting the default browser"));
    case "launchAtLoginStatus":
      return capabilities.launchAtLogin ? undefined : () => Promise.resolve("notFound");
    case "setLaunchAtLogin":
      return capabilities.launchAtLogin ? undefined : () => Promise.reject(unavailableError("Opening at login"));
    case "setThinScrollBars":
      return capabilities.thinScrollBars ? undefined : () => Promise.resolve();
    case "hapticTick":
      return hostSupports("ArdiaSystem.hapticTick", host) ? undefined : () => Promise.resolve();
  }
  return undefined;
}
