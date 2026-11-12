import type { ExtensionSearchEngine } from "@ardia/core";
import { extensionSearchEngines } from "../../platform/extensions";
import { useBrowser } from "../browser/store";
import { useExtensions } from "./actions";

export function startExtensionSearchEngines() {
  const timers: Record<string, ReturnType<typeof setTimeout>> = {};
  const read = new Set<string>();
  useExtensions.subscribe((e, prev) => {
    if (e.lists === prev.lists) return;
    for (const [profile, list] of Object.entries(e.lists)) {
      if (list === prev.lists[profile]) continue;
      clearTimeout(timers[profile]);
      timers[profile] = setTimeout(() => void refreshExtensionSearchEngines(profile), 400);
      if (!read.has(profile)) setTimeout(() => void refreshExtensionSearchEngines(profile), 3000);
      read.add(profile);
    }
  });
}

async function refreshExtensionSearchEngines(profile: string) {
  let engines: ExtensionSearchEngine[];
  try {
    engines = await extensionSearchEngines(profile);
  } catch (error) {
    console.warn("[extensions] search engines failed", error);
    return;
  }
  const s = useBrowser.getState();
  const current = s.settings.extensionSearchEngines;
  const next = [...current.filter((e) => e.profile !== profile), ...engines];
  if (JSON.stringify(next) !== JSON.stringify(current)) s.updateSettings({ extensionSearchEngines: next });
}
