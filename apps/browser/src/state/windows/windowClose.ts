import { confirm } from "../../platform/dialogs";
import { onWindowEvent } from "../../platform/windows";
import { useBrowser } from "../browser/store";
import { inPinnedContainer, plural, profileFor } from "../browser/model";
import { isSmall } from "./small";
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
  const { decision, suppressWarning } = await decideWindowClose(windowId);
  if (suppressWarning) useBrowser.getState().updateSettings({ warnBeforeClosingWindow: false });
  if (decision === "cancel") return;
  closeWindowAnimated(windowId);
}

export type CloseAsk = typeof confirm;
export type WindowCloseDecision = { decision: "allow" | "cancel"; suppressWarning: boolean };

const allow = (): WindowCloseDecision => ({ decision: "allow", suppressWarning: false });

async function askToClose(windowId: string, ask: CloseAsk): Promise<WindowCloseDecision> {
  const { confirmed, suppressed } = await ask({ ...closeWindowDialog(windowId), suppression: "Don’t ask me again", windowId });
  return { decision: confirmed ? "allow" : "cancel", suppressWarning: suppressed };
}

export async function decideWindowClose(windowId: string, ask: CloseAsk = confirm): Promise<WindowCloseDecision> {
  const s = useBrowser.getState();
  if (!s.settings.warnBeforeClosingWindow || closingTabs(windowId).length < MIN_TABS) return allow();
  return askToClose(windowId, ask);
}

export async function decideLastTabClose(windowId: string, ask: CloseAsk = confirm): Promise<WindowCloseDecision> {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (!w || !s.settings.warnBeforeClosingLastTab || w.kind === "private") return allow();
  return askToClose(windowId, ask);
}

const closingTabs = (windowId: string) => {
  const s = useBrowser.getState();
  return (s.windows[windowId]?.tabIds ?? []).filter((id) => !inPinnedContainer(s, id));
};

export function closeWindowDialog(windowId: string) {
  const s = useBrowser.getState();
  const w = s.windows[windowId]!;
  const tabs = (n: number) => plural(n, "tab");
  const byProfile = new Map<string, number>();
  const closing = closingTabs(windowId);
  for (const id of closing) {
    const profileId = s.tabs[id]?.profileId ?? w.profileId;
    byProfile.set(profileId, (byProfile.get(profileId) ?? 0) + 1);
  }
  const count = closing.length;
  const message =
    byProfile.size > 1
      ? ["Closing this window closes all tabs open across profiles:", ...[...byProfile].map(([id, n]) => `  • ${tabs(n)} in ${profileFor(s, id).name}`)].join("\n")
      : `This window has ${tabs(count)} open in your ${profileFor(s, w.profileId).name} profile.`;
  return {
    title: count === 1 ? "Close 1 tab?" : `Close ${count} tabs?`,
    message,
    confirmTitle: count === 1 ? "Close Tab" : "Close All Tabs",
  };
}
