import type { WebViewHandle } from "../../platform/webviews";
import type { BrowserState } from "../browser/store";
import { engineProfile } from "../browser/model";
import { isInternalTab } from "../pages/urls";
import { profileUnloadDelay } from "./idleProfiles";
import { asleepFrom, hasPage, wokenPage } from "../tabs/pageSession";

export const profileSelected = (s: BrowserState, profile: string) =>
  Object.values(s.windows).some((window) => engineProfile(s, window.profileId) === profile);

export async function suspendProfilePages(profile: string, port: {
  state(): BrowserState;
  handles: ReadonlyMap<string, WebViewHandle>;
}): Promise<boolean> {
  const initial = port.state();
  const unloadAfter = initial.settings.unloadProfilesAfter;
  if (profileUnloadDelay(initial.settings) === null || profileSelected(initial, profile)) return false;
  for (const tab of Object.values(initial.tabs)) {
    if (engineProfile(initial, tab.profileId) !== profile || !hasPage(tab) || isInternalTab(tab)) continue;
    const before = port.state();
    if (before.settings.unloadProfilesAfter !== unloadAfter
      || profileUnloadDelay(before.settings) === null || profileSelected(before, profile)) return false;
    if (before.tabs[tab.id] !== tab) return false;
    const handle = port.handles.get(tab.id);
    if (!handle) return false;
    const result = await handle.discard({ unload: true });
    if (result !== "unloaded") return false;
    const after = port.state();
    const current = after.tabs[tab.id];
    if (!current || engineProfile(after, current.profileId) !== profile
      || current.page !== tab.page || current.url !== tab.url) return false;
    const page = asleepFrom(current);
    after.updateTab(tab.id, {
      page: profileSelected(after, profile) ? wokenPage({ ...current, page }) : page,
    });
    if (port.state().settings.unloadProfilesAfter !== unloadAfter
      || profileSelected(port.state(), profile) || profileUnloadDelay(port.state().settings) === null) return false;
  }
  return !profileSelected(port.state(), profile);
}
