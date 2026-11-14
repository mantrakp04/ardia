import { followKeyboard, type FollowKeyboard } from "../../platform/keyboardFollow";
import { useBrowser } from "../browser/store";
import type { BrowserState } from "../browser/store";

type Store = { getState(): Pick<BrowserState, "windows">; subscribe(listener: (state: Pick<BrowserState, "windows">, prev: Pick<BrowserState, "windows">) => void): () => void };

const shownTabOf = (s: Pick<BrowserState, "windows">, windowId: string) => {
  const w = s.windows[windowId];
  return w ? w.activeTabIds[w.profileId] : undefined;
};

export function startKeyboardFollows(follow: FollowKeyboard | null = followKeyboard, store: Store = useBrowser): () => void {
  if (!follow) return () => {};
  return store.subscribe((s, prev) => {
    if (s.windows === prev.windows) return;
    for (const windowId of Object.keys(s.windows)) {
      const shown = shownTabOf(s, windowId);
      if (shown && shown !== shownTabOf(prev, windowId)) follow(shown);
    }
  });
}
