import { faviconsFor } from "../../platform/favicons";
import { installWebApp, openFile } from "../../platform/files";
import { focus } from "../browser/actions";
import { useBrowser } from "../browser/store";
import type { Tab } from "../browser/types";
import { prompt } from "../app/system";
import { openLittleArdia } from "../littleArdia/actions";
import { isWindowClosing } from "../windows/closingWindows";
import { lastActiveProfile } from "../windows/small";

const ICON_SIZE = 128;
const SCHEME = "ardia-app:";
const openApps = new Map<string, string>();

export async function installPageAsApp(tab: Tab, windowId: string) {
  if (!/^https?:/i.test(tab.url) || useBrowser.getState().windows[windowId]?.incognito) return;
  const name = await prompt({
    title: "Install as App",
    value: tab.customTitle || tab.title || new URL(tab.url).hostname,
    placeholder: new URL(tab.url).hostname,
    confirmTitle: "Install",
    windowId,
  });
  if (!name?.trim()) return;
  const icon = (await faviconsFor(tab.profileId, [tab.url], [], ICON_SIZE).catch(() => null))?.pages.get(tab.url)?.uri ?? null;
  const path = await installWebApp(name.trim(), tab.url, tab.profileId, icon);
  if (path) void openFile(path);
}

export function openWebApp(link: string): boolean {
  if (!link.toLowerCase().startsWith(SCHEME)) return false;
  const query = new URL(link).searchParams;
  const url = query.get("url") ?? "";
  if (!/^https?:/i.test(url)) return true;
  const s = useBrowser.getState();
  const key = `${query.get("profile")}\n${url}`;
  const open = openApps.get(key);
  if (open && s.windows[open] && !isWindowClosing(open)) {
    focus(open);
    return true;
  }
  const profile = query.get("profile") ?? "";
  openApps.set(key, openLittleArdia(url, s.profiles[profile] ? profile : lastActiveProfile(s)));
  return true;
}
