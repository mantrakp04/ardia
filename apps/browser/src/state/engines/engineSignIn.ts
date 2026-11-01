import { importWebKitCookies, webKitCookieStoreKey } from "../../platform/webkit";
import type { WebViewHandle } from "../../platform/tabs";
import { useBrowser } from "../browser/store";
import { tabEngine } from "./engines";
import { engineProfile, engineProfileForSpace } from "../browser/model";
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
  return !!t && engineProfile(s, t.spaceId) === profile && webviews.get(tabId) === web && tabEngine(s, tabId) === "chromium";
}

async function copyCookies(tabId: string, url: string): Promise<number> {
  const t = useBrowser.getState().tabs[tabId];
  const web = webviews.get(tabId);
  const urls = cookieAddresses(url);
  if (!t || !web || !urls.length) return 0;
  const space = engineProfileForSpace(t.spaceId);
  if (!stillChromiumPage(tabId, space, web)) return 0;
  const storeKey = await webKitCookieStoreKey(space);
  if (storeKey == null || !stillChromiumPage(tabId, space, web)) return 0;
  const cookies = carriableCookies(await web.pageCookies(urls), Date.now() / 1000);
  if (!cookies.length || !stillChromiumPage(tabId, space, web)) return 0;
  return importWebKitCookies(space, storeKey, cookies);
}

export function carrySignInToWebKit(tabId: string, url: string): Promise<number> {
  if (!signInCarryOn()) return Promise.resolve(0);
  return withDeadline(copyCookies(tabId, url).catch(() => 0), CARRY_DEADLINE_MS, 0);
}
