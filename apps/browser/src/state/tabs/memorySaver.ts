import { isKeepActiveSiteValid, setMemorySaver, type MemorySaverMode } from "../../platform/performance";
import { useBrowser } from "../browser/store";
import type { Settings } from "../settings/settings";

type MemorySaverSettings = Pick<Settings, "memorySaver" | "memorySaverMode" | "keepActiveSites">;

export type { MemorySaverMode };

const MODES: readonly MemorySaverMode[] = ["moderate", "balanced", "maximum"];

const store = () => useBrowser.getState();

export function memorySaverRequest(settings: MemorySaverSettings) {
  return {
    state: settings.memorySaver === false ? ("off" as const) : ("on" as const),
    aggressiveness: MODES.includes(settings.memorySaverMode) ? settings.memorySaverMode : ("balanced" as const),
    sites: Array.isArray(settings.keepActiveSites) ? settings.keepActiveSites.filter((site) => typeof site === "string") : [],
  };
}

const changed = (a: MemorySaverSettings, b: MemorySaverSettings) =>
  a.memorySaver !== b.memorySaver || a.memorySaverMode !== b.memorySaverMode || a.keepActiveSites !== b.keepActiveSites;

let started = false;

export function startMemorySaver() {
  if (started) return;
  started = true;
  const push = () => void setMemorySaver(memorySaverRequest(useBrowser.getState().settings)).catch(() => {});
  push();
  useBrowser.subscribe((s, prev) => {
    if (changed(s.settings, prev.settings)) push();
  });
}

export function keepActiveSiteOf(typed: string): string {
  const [, scheme = "", host = "", rest = ""] = /^([a-z][\w+.-]*:\/\/)?([^/?#]*)(.*)$/is.exec(typed.trim()) ?? [];
  return `${scheme.toLowerCase()}${host.toLowerCase()}${rest === "/" ? "" : rest}`;
}

export async function keepSiteActive(typed: string): Promise<string | null> {
  const site = keepActiveSiteOf(typed);
  if (!site || /\s/.test(site) || !(await isKeepActiveSiteValid(site).catch(() => false))) return "Enter a site, like youtube.com.";
  const sites = store().settings.keepActiveSites;
  if (!sites.includes(site)) store().updateSettings({ keepActiveSites: [...sites, site] });
  return null;
}

export function stopKeepingSiteActive(site: string) {
  const sites = store().settings.keepActiveSites;
  if (sites.includes(site)) store().updateSettings({ keepActiveSites: sites.filter((s) => s !== site) });
}
