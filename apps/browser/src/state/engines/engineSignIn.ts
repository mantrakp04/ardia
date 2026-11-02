import { importWebKitCookies, webKitCookieStoreKey } from "../../platform/webkit";
import type { WebViewHandle } from "../../platform/tabs";
import { useBrowser } from "../browser/store";
import { tabEngine } from "./engines";
import { engineProfile } from "../browser/model";
import { carriableCookies, cookieAddresses } from "./signInCookies";
import { webviews } from "../../platform/webviews";
import { experimentOn } from "../../platform/killSwitches";
import { withDeadline } from "../../lib/deadline";

const CARRY_DEADLINE_MS = 1500;

let carryOn: boolean | undefined;

export const signInCarryOn = () => (carryOn ??= experimentOn("webkitSignIn"));

function stillChromiumPage(tabId: string, profile: string, web: WebViewHandle) {
  const s = useBrowser.getState();
  const t = s.tabs[tabId];
  return !!t && engineProfile(s, t.profileId) === profile && webviews.get(tabId) === web && tabEngine(s, tabId) === "chromium";
}

async function copyCookies(tabId: string, url: string): Promise<number> {
  const t = useBrowser.getState().tabs[tabId];
  const web = webviews.get(tabId);
  const urls = cookieAddresses(url);
  if (!t || !web || !urls.length) return 0;
  const profile = engineProfile(useBrowser.getState(), t.profileId);
  if (!stillChromiumPage(tabId, profile, web)) return 0;
  const storeKey = await webKitCookieStoreKey(profile);
  if (storeKey == null || !stillChromiumPage(tabId, profile, web)) return 0;
  const cookies = carriableCookies(await web.pageCookies(urls), Date.now() / 1000);
  if (!cookies.length || !stillChromiumPage(tabId, profile, web)) return 0;
  return importWebKitCookies(profile, storeKey, cookies);
}

export function carrySignInToWebKit(tabId: string, url: string): Promise<number> {
  if (!signInCarryOn()) return Promise.resolve(0);
  return withDeadline(copyCookies(tabId, url).catch(() => 0), CARRY_DEADLINE_MS, 0);
}
