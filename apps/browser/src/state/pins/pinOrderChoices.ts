import { useBrowser, type BrowserState } from "../browser/store";
import { isIncognitoSpace } from "../browser/model";
import { nextPinChoice, orderChoiceKey } from "./pinChoices";
import { anchorsOf, pinnedAreaKeys } from "./pinnedArea";
import type { TabGroup } from "../browser/types";
import { isRegularWindow } from "../windows/small";

let remote = 0;

export function fromSync<T>(apply: () => T): T {
  remote++;
  try {
    return apply();
  } finally {
    remote--;
  }
}

function homes(s: BrowserState): Map<string, string> {
  const out = new Map<string, string>();
  for (const spaceId of new Set(Object.values(s.groups).filter((g) => g.pinned && !g.parentId).map((g) => g.spaceId))) {
    if (isIncognitoSpace(spaceId)) continue;
    const home = [...s.ui.focusOrder, ...s.windowOrder].map((id) => s.windows[id]).find((w) => isRegularWindow(w) && w.tabIds.some((id) => s.tabs[id]?.spaceId === spaceId));
    if (home) out.set(spaceId, home.id);
  }
  return out;
}

const orderShape = (g: TabGroup) => `${g.pinned}|${g.parentId ?? ""}|${g.windowId}|${g.spaceId}|${g.pinKey ?? ""}`;

function groupsReordered(s: BrowserState, prev: BrowserState): boolean {
  if (s.groups === prev.groups) return false;
  for (const id of new Set([...Object.keys(s.groups), ...Object.keys(prev.groups)])) {
    const g = s.groups[id];
    const was = prev.groups[id];
    if (!g || !was || g.tabIds !== was.tabIds || orderShape(g) !== orderShape(was)) return true;
  }
  return false;
}

export function noteOrderChoices(s: BrowserState, prev: BrowserState) {
  if (remote) return;
  if (!groupsReordered(s, prev) && Object.values(s.windows).every((w) => w.tabIds === prev.windows[w.id]?.tabIds)) return;
  const homesBefore = homes(prev);
  let pinChoices = s.pinChoices;
  for (const [spaceId, windowId] of homes(s)) {
    if (homesBefore.get(spaceId) !== windowId) continue;
    const before = pinnedAreaKeys(prev, prev.windows[windowId]!, spaceId);
    const after = pinnedAreaKeys(s, s.windows[windowId]!, spaceId);
    const now = new Set(after);
    const kept = new Set(before.filter((k) => now.has(k)));
    const was = anchorsOf(before.filter((k) => kept.has(k)));
    const moved = [...anchorsOf(after.filter((k) => kept.has(k)))].filter(([group, a]) => was.get(group) !== a).map(([group]) => orderChoiceKey(group));
    if (moved.length) pinChoices = { ...pinChoices, [spaceId]: { ...pinChoices[spaceId], ...Object.fromEntries(moved.map((k) => [k, nextPinChoice()])) } };
  }
  if (pinChoices !== s.pinChoices) useBrowser.setState({ pinChoices });
}

useBrowser.subscribe(noteOrderChoices);
