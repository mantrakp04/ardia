import { confirm } from "../../platform/dialogs";
import { onWindowEvent } from "../../platform/windows";
import { useBrowser } from "../browser/store";
import { plural, profileFor } from "../browser/model";
import { isSmall } from "./small";
import { closeLittleArdia } from "../littleArdia/actions";
import { closeWindowAnimated } from "./closeAnimated";
import { isWindowClosing } from "./closingWindows";
import { tabsLostOnClose } from "../tabs/tabShare";

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
  const lost = lostOnClose(windowId);
  if (s.settings.warnBeforeClosingWindow && lost.length >= MIN_TABS) {
    const { confirmed, suppressed } = await confirm({ ...closeWindowDialog(windowId, lost), suppression: "Don’t ask me again", windowId });
    if (suppressed) useBrowser.getState().updateSettings({ warnBeforeClosingWindow: false });
    if (!confirmed) return;
  }
  closeWindowAnimated(windowId);
}

export function lostOnClose(windowId: string): string[] {
  const s = useBrowser.getState();
  const windows = Object.fromEntries(Object.entries(s.windows).filter(([id]) => id === windowId || !isWindowClosing(id)));
  return tabsLostOnClose({ ...s, windows }, windowId).map((t) => t.id);
}

export function closeWindowDialog(windowId: string, closing: string[] = lostOnClose(windowId)) {
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
      : `Closing this window closes ${tabs(count)} in your ${profileFor(s, [...byProfile.keys()][0] ?? w.profileId).name} profile.`;
  return {
    title: count === 1 ? "Close 1 tab?" : `Close ${count} tabs?`,
    message,
    confirmTitle: count === 1 ? "Close Tab" : "Close All Tabs",
  };
}
