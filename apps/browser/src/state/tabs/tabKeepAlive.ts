import type { BrowserState } from "../browser/store";
import { activeTabId } from "../browser/model";
import { useMedia } from "../media/media";
import { isInternalTab } from "../pages/urls";
import { peekTabId } from "../peek/peek";
import { splitOf } from "../splits/splits";
import { pageOf } from "./pageState";
import type { webviews } from "../../platform/webviews";

type WebViewHandle = NonNullable<ReturnType<typeof webviews.get>>;

const EVAL_TIMEOUT_MS = 2_000;

export function shownTabIds(s: BrowserState): Set<string> {
  const shown = new Set<string>();
  for (const w of Object.values(s.windows)) {
    const id = activeTabId(s, w.id);
    if (!id) continue;
    shown.add(id);
    const peek = peekTabId(s, w.id);
    if (peek) shown.add(peek);
    const held = s.tabs[id]?.pageIn;
    if (held) shown.add(held);
    for (const pane of splitOf(s, id)?.tabIds ?? []) shown.add(pane);
  }
  return shown;
}

export function keepAliveReason(s: BrowserState, id: string): string | null {
  const tab = s.tabs[id];
  if (!tab?.url || isInternalTab(tab)) return "no page";
  const live = s.live[id];
  if (live?.playingAudio) return "playing audio";
  if (live?.isLoading) return "loading";
  const page = pageOf(id);
  if (page.mediaAccess) return "capturing";
  if (page.permission) return "asking for permission";
  if (page.newTabShown) return "kept for Forward";
  const media = useMedia.getState();
  if (media.pipOpen[id]) return "picture in picture";
  if (media.displayRequests[id]) return "choosing a screen to share";
  const session = media.sessions[id];
  if (session?.playbackState === "playing" || (tab.pinned && session)) return "media";
  if (splitOf(s, id)) return "in a split";
  return null;
}

const UNSAVED_INPUT_CHECK = `
const notText = new Set(["hidden", "submit", "button", "reset", "image", "search", "checkbox", "radio", "range", "color"]);
const dirty = (doc) => {
  for (const el of doc.querySelectorAll("input, textarea")) {
    if (el.disabled || el.readOnly) continue;
    if (el.type === "file") {
      if (el.files && el.files.length) return true;
    } else if (!notText.has(el.type) && el.value && el.value !== el.defaultValue) {
      return true;
    }
  }
  const active = doc.activeElement;
  return !!(active && active.isContentEditable && active.textContent.trim());
};
let unsaved = typeof window.onbeforeunload === "function" || dirty(document);
for (let i = 0; !unsaved && i < frames.length; i++) {
  try { unsaved = typeof frames[i].onbeforeunload === "function" || dirty(frames[i].document); } catch (e) {}
}
post("result", JSON.stringify(unsaved));`;

const withTimeout = <T,>(promise: Promise<T>, ms: number, fallback: T) =>
  Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

export async function hasUnsavedInput(handle: WebViewHandle): Promise<boolean | null> {
  const result = await withTimeout(handle.evaluate<boolean>(UNSAVED_INPUT_CHECK).catch(() => null), EVAL_TIMEOUT_MS, null);
  return typeof result === "boolean" ? result : null;
}
