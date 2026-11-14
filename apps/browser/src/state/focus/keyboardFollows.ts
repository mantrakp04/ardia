import { followKeyboard, type FollowKeyboard } from "../../platform/keyboardFollow";
import { useBrowser } from "../browser/store";
import type { BrowserState } from "../browser/store";

type Followed = Pick<BrowserState, "windows" | "peeks">;
type Store = { getState(): Followed; subscribe(listener: (state: Followed, prev: Followed) => void): () => void };

const shownTabOf = (s: Followed, windowId: string) => {
  const w = s.windows[windowId];
  return w ? w.activeTabIds[w.profileId] : undefined;
};

export function startKeyboardFollows(follow: FollowKeyboard | null = followKeyboard, store: Store = useBrowser): () => void {
  if (!follow) return () => {};
  return store.subscribe((s, prev) => {
    if (s.windows === prev.windows && s.peeks === prev.peeks) return;
    for (const windowId of Object.keys(s.windows)) {
      const shown = shownTabOf(s, windowId);
      if (shown && shown !== shownTabOf(prev, windowId)) follow(shown);
      const peek = s.peeks[windowId]?.tabId;
      if (peek && peek !== prev.peeks[windowId]?.tabId) follow(peek);
    }
  });
}
