import { confirm } from "../../platform/dialogs";
import { onWindowEvent } from "../../platform/windows";
import { useBrowser } from "../browser/store";
import { inPinnedContainer, plural, profileFor } from "../browser/model";
import { tabsClosedWithWindow } from "../tabs/tabShare";
import { isOpenRegularWindow, isSmall } from "./small";
import { closeLittleArdia } from "../littleArdia/actions";
import { closeWindowAnimated } from "./closeAnimated";

const MIN_TABS = 2;

export function startWindowCloseGuard() {
  const pending = new Set<string>();
  onWindowEvent((e) => {
    if (e.type !== "closeRequest" || pending.has(e.id)) return;
    pending.add(e.id);
    void requestClose(e.id).finally(() => pending.delete(e.id));
  });
}

async function requestClose(windowId: string) {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (!w) return;
  if (isSmall(s, windowId)) return closeLittleArdia(windowId);
  const asked = new Set<string>();
  for (;;) {
    const now = useBrowser.getState();
    if (!now.windows[windowId]) return;
    const closing = tabsClosedWithWindow(now, windowId, isOpenRegularWindow).map((t) => t.id);
    if (!now.settings.warnBeforeClosingWindow || closing.length < MIN_TABS || closing.every((id) => asked.has(id))) break;
    const { confirmed, suppressed } = await confirm({ ...closeWindowDialog(windowId, closing), suppression: "Don’t ask me again", windowId });
    if (suppressed) useBrowser.getState().updateSettings({ warnBeforeClosingWindow: false });
    if (!confirmed) return;
    for (const id of closing) asked.add(id);
  }
  closeWindowAnimated(windowId);
}

const unpinnedTabIds = (windowId: string) => {
  const s = useBrowser.getState();
  return (s.windows[windowId]?.tabIds ?? []).filter((id) => !inPinnedContainer(s, id));
};

export function closeWindowDialog(windowId: string, closing = unpinnedTabIds(windowId)) {
  const s = useBrowser.getState();
  const w = s.windows[windowId]!;
  const tabs = (n: number) => plural(n, "tab");
  const byProfile = new Map<string, number>();
  for (const id of closing) {
    const profileId = s.tabs[id]?.profileId ?? w.profileId;
    byProfile.set(profileId, (byProfile.get(profileId) ?? 0) + 1);
  }
  const count = closing.length;
  const message =
    byProfile.size > 1
      ? ["Closing this window closes all tabs open across profiles:", ...[...byProfile].map(([id, n]) => `  • ${tabs(n)} in ${profileFor(s, id).name}`)].join("\n")
      : `This window has ${tabs(count)} open in your ${profileFor(s, [...byProfile.keys()][0] ?? w.profileId).name} profile.`;
  return {
    title: count === 1 ? "Close 1 tab?" : `Close ${count} tabs?`,
    message,
    confirmTitle: count === 1 ? "Close Tab" : "Close All Tabs",
  };
}
