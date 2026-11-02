import { confirm } from "../../platform/dialogs";
import { onWindowEvent } from "../../platform/windows";
import { useBrowser } from "../browser/store";
import type { BrowserState } from "../browser/store";
import { familyKeyOf, inPinnedContainer, plural, profileFor } from "../browser/model";
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
  if (unpinnedTabs(s, windowId).length < MIN_TABS) return closeWindowAnimated(windowId);
  const { confirmed } = await confirmLostTabs(windowId, "warnBeforeClosingWindow", () => lostOnClose(windowId));
  if (confirmed) closeWindowAnimated(windowId);
}

const unpinnedTabs = (s: BrowserState, windowId: string) => (s.windows[windowId]?.tabIds ?? []).filter((id) => !inPinnedContainer(s, id));

type LossWarning = "warnBeforeClosingWindow" | "warnBeforeClosingLastTab";

export async function confirmLostTabs(windowId: string, setting: LossWarning, lostNow: () => string[]): Promise<{ confirmed: boolean; asked: boolean }> {
  const lostTabs = () => oneLivePerFamily(lostNow());
  let lost = lostTabs();
  let asked = false;
  while (useBrowser.getState().settings[setting] && lost.length) {
    const families = new Set(lostFamilies(lost));
    asked = true;
    const { confirmed, suppressed } = await confirm({ ...closeWindowDialog(windowId, lost), suppression: "Don’t ask me again", windowId });
    if (suppressed) useBrowser.getState().updateSettings({ [setting]: false });
    if (!confirmed) return { confirmed: false, asked };
    lost = lostTabs();
    if (lostFamilies(lost).every((key) => families.has(key))) break;
  }
  return { confirmed: true, asked };
}

export function lostOnClose(windowId: string): string[] {
  const s = useBrowser.getState();
  const windows = Object.fromEntries(Object.entries(s.windows).filter(([id]) => id === windowId || !isWindowClosing(id)));
  return tabsLostOnClose({ ...s, windows }, windowId).map((t) => t.id);
}

function oneLivePerFamily(ids: string[]): string[] {
  const s = useBrowser.getState();
  const seen = new Set<string>();
  return ids.filter((id) => {
    const t = s.tabs[id];
    if (!t || seen.has(familyKeyOf(t))) return false;
    seen.add(familyKeyOf(t));
    return true;
  });
}

function lostFamilies(ids: string[]): string[] {
  const s = useBrowser.getState();
  return ids.map((id) => s.tabs[id]).filter((t) => !!t).map((t) => familyKeyOf(t!));
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
      ? [`Closing this window closes ${tabs(count)} across profiles:`, ...[...byProfile].map(([id, n]) => `  • ${tabs(n)} in ${profileFor(s, id).name}`)].join("\n")
      : `Closing this window closes ${tabs(count)} in your ${profileFor(s, [...byProfile.keys()][0] ?? w.profileId).name} profile.`;
  return {
    title: count === 1 ? "Close 1 tab?" : `Close ${count} tabs?`,
    message,
    confirmTitle: count === 1 ? "Close Tab" : "Close All Tabs",
  };
}
