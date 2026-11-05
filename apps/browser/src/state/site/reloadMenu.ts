import { confirm } from "../../platform/dialogs";
import { showMenu, type MenuItem } from "../../platform/menus";
import { webviews } from "../../platform/webviews";
import { clearSiteData } from "../../platform/siteSettings";
import { getContentBlocker, isContentBlockerAllowed, setContentBlockerAllowed } from "../../platform/contentBlocker";
import { menuSections } from "../app/menuSections";
import { currentTab } from "../browser/current";
import { engineProfile } from "../browser/model";
import type { Tab } from "../browser/types";
import { tabEngine } from "../engines/engines";
import { useBrowser } from "../browser/store";
import { openSettings } from "../settings/settingsWindows";
import { showToast } from "../app/toasts";
import { setPopover } from "../tabs/pageState";

export function siteOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

export async function setSiteBlocking(tab: Pick<Tab, "id" | "windowId">, host: string, on: boolean): Promise<boolean> {
  const failed = await setContentBlockerAllowed(host, !on).then(
    () => false,
    () => true,
  );
  const allowed = await isContentBlockerAllowed(host);
  if (failed) showToast(tab.windowId, "Couldn't Change the Ad Blocker", `Blocking on ${host} is as it was. Try again.`, { icon: "exclamationmark.triangle" });
  else void webviews.get(tab.id)?.reload();
  return allowed;
}

export async function clearSiteDataAfterConfirm(tab: Pick<Tab, "id" | "windowId" | "profileId">, origin: string): Promise<number | null> {
  const host = new URL(origin).hostname;
  const engine = tabEngine(useBrowser.getState(), tab.id);
  const { confirmed } = await confirm({
    title: `Clear cookies and site data for ${host}?`,
    message: "You'll be signed out of this site, and its offline data will be deleted.",
    confirmTitle: "Clear",
    destructive: true,
    windowId: tab.windowId,
  });
  if (!confirmed) return null;
  const profile = engineProfile(useBrowser.getState(), tab.profileId);
  const result = await clearSiteData(profile, origin, engine).catch(() => null);
  const now = currentTab(tab.id);
  if (now && now.profileId === tab.profileId && siteOrigin(now.url) === origin) void webviews.get(tab.id)?.reload();
  return result && typeof result.cookies === "number" ? result.cookies : 0;
}

export type ReloadMenuState = { blocker: "on" | "off" | "offInSettings" | "unavailable" };

export function reloadMenuItems({ blocker }: ReloadMenuState): MenuItem[] {
  return menuSections(
    [{ id: "blocking", title: "Block Ads & Trackers", symbol: "hand.raised", checked: blocker === "on", enabled: blocker !== "unavailable" }],
    [
      {
        id: "site",
        title: "Site Settings",
        symbol: "gearshape",
        children: menuSections([{ id: "clearData", title: "Clear Cookies and Site Data…", symbol: "trash" }], [{ id: "siteControls", title: "Site Controls…" }]),
      },
    ],
  );
}

export async function showReloadMenu(tabId: string) {
  const tab = currentTab(tabId);
  const origin = tab ? siteOrigin(tab.url) : null;
  if (!tab || !origin) return;
  const host = new URL(origin).hostname;
  const webkit = tabEngine(useBrowser.getState(), tabId) === "webkit";
  const [state, allowed] = webkit ? [null, false] : await Promise.all([getContentBlocker().catch(() => null), isContentBlockerAllowed(host).catch(() => false)]);
  const blocker: ReloadMenuState["blocker"] = webkit || !state ? "unavailable" : !state.enabled ? "offInSettings" : allowed ? "off" : "on";
  const choice = await showMenu(reloadMenuItems({ blocker }));
  if (choice === "blocking") {
    if (blocker === "offInSettings") return openSettings("privacy");
    return void setSiteBlocking(tab, host, blocker === "off");
  }
  if (choice === "clearData") return void clearSiteDataAfterConfirm(tab, origin);
  if (choice === "siteControls") setPopover(tabId, "siteControls");
}
