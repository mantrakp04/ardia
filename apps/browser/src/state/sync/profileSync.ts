import { type Adapter, type ExtensionsAdapter } from "../../platform/sync";
import { useBrowser } from "../browser/store";
import { profileEngine } from "../profiles/current";
import { bookmarksAdapter, historyAdapter, inTodaysNames, passwordsAdapter } from "./adapters";
import { topAppsAdapter } from "./identityAdapters";
import { extensionsAdapterFor, watchExtensionIntents } from "./extensions";
import type { SyncDoc } from "./syncDoc";

export function createProfileSync(current: () => SyncDoc) {
  const passwordAdapters = new Map<string, (forced: boolean) => Adapter>();
  const extensionAdapters = new Map<string, ExtensionsAdapter>();
  function adapters(profileId: string, forced: boolean): Adapter[] {
    const s = useBrowser.getState();
    const representative = s.spaceOrder.find((id) => s.spaces[id]?.profileId === profileId);
    const link = current().profiles[profileId];
    if (!link || !s.profiles[profileId]) return [];
    const context = { profileId, engineId: s.profiles[profileId]!.engineId };
    const t = current().types;
    let passwords = passwordAdapters.get(profileId);
    if (!passwords) passwordAdapters.set(profileId, passwords = passwordsAdapter(profileId, undefined, () => profileEngine(profileId)));
    return [
      ...(t.pinned && link.topAppsEnabled ? [topAppsAdapter(profileId)] : []),
      ...(t.bookmarks && link.enabled && representative ? [inTodaysNames(bookmarksAdapter(representative, { ...context, enabled: () => !!current().profiles[profileId]?.enabled && current().types.bookmarks }))] : []),
      ...(t.history && link.enabled && representative ? [inTodaysNames(historyAdapter(representative, { ...context, enabled: () => !!current().profiles[profileId]?.enabled && current().types.history }))] : []),
      ...(t.passwords && link.enabled ? [passwords(forced)] : []),
      ...(t.extensions && link.enabled ? [extensionsOf(profileId)] : []),
    ];
  }

  async function watchExtensions() {
    if (!current().enabled || !current().protocolReady || !current().types.extensions) return;
    const profiles = Object.entries(current().profiles).filter(([id, link]) => link.enabled && useBrowser.getState().profiles[id]).map(([id]) => profileEngine(id));
    if (profiles.length) watchExtensionIntents(profiles);
  }

  function extensionsOf(profileId: string): ExtensionsAdapter {
    let adapter = extensionAdapters.get(profileId);
    if (!adapter) extensionAdapters.set(profileId, adapter = extensionsAdapterFor(profileId, () => profileEngine(profileId)));
    return adapter;
  }

  return { adapters, watchExtensions, extensionsOf, clear: () => { passwordAdapters.clear(); extensionAdapters.clear(); } };
}
