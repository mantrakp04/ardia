import { unavailableError } from "./hostCapabilities.ts";

export const CAST_UNAVAILABLE_TITLE = "Casting Isn't Available";
const CAST_UNAVAILABLE_MESSAGE = "Ardia for Linux can't cast tabs yet.";

const UNAVAILABLE: Record<string, string> = {
  startCasting: "Casting",
  stopCasting: "Casting",
  closeCastDialog: "Casting",
  terminateCastRoute: "Casting",
  changeCaptureSource: "Switching the shared tab",
  stopCapture: "Stopping a capture from Ardia",
};

async function noticeCastUnavailable(args: string) {
  let tabId: unknown;
  try { tabId = (JSON.parse(args) as { tabId?: unknown } | null)?.tabId; } catch { tabId = null; }
  const [{ useBrowser }, { showToast }] = await Promise.all([
    import("../../browser/src/state/browser/store"),
    import("../../browser/src/state/app/toasts"),
  ]);
  const s = useBrowser.getState();
  const tab = typeof tabId === "string" ? s.tabs[tabId] : undefined;
  const windowId = tab?.windowId ?? s.ui.focusOrder[0] ?? null;
  if (windowId) showToast(windowId, CAST_UNAVAILABLE_TITLE, CAST_UNAVAILABLE_MESSAGE, { icon: "tv.and.mediabox" });
}

export function linuxMediaCall(verb: string, args: string): Promise<string> | undefined {
  if (verb === "showCastDialog") return noticeCastUnavailable(args).then(() => "false", () => "false");
  if (verb === "watchCastRoutes") return Promise.resolve("null");
  const feature = UNAVAILABLE[verb];
  return feature ? Promise.reject(unavailableError(feature)) : undefined;
}
