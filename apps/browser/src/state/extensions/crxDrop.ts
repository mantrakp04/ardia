import { installExtensionCrx, onExtensionInstallFailed } from "../../platform/extensions";
import { useBrowser } from "../browser/store";
import { extensionProfile } from "./store";
import { showToast } from "../app/toasts";
import { focusedWindowOf } from "../windows/ui";

export function crxPath(url: string): string | null {
  const encoded = /^file:\/\/(\/[^/?#][^?#]*)$/i.exec(url)?.[1];
  if (!encoded) return null;
  try {
    const path = decodeURIComponent(encoded);
    return /\.crx$/i.test(path) ? path : null;
  } catch {
    return null;
  }
}

const toast = (windowId: string, message: string) =>
  showToast(windowId, "Couldn't add the extension", message, { icon: "puzzlepiece.extension" });

export function installDroppedCrx(windowId: string, urls: string[]): string[] {
  const paths = urls.map(crxPath);
  if (!paths.some(Boolean)) return urls;
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (!w || w.kind === "private") return urls;
  const profile = extensionProfile(s, windowId);
  for (const path of paths) if (path) void installExtensionCrx(path, profile).catch((error: Error) => toast(windowId, error.message));
  return urls.filter((_, i) => !paths[i]);
}

export function watchExtensionInstallFailures() {
  onExtensionInstallFailed(({ message, tabId }) => {
    const s = useBrowser.getState();
    const windowId = (tabId && s.tabs[tabId]?.windowId) || focusedWindowOf(s) || s.windowOrder[0];
    if (windowId) toast(windowId, message);
  });
}
