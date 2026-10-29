import { confirm } from "../../platform/dialogs";
import { onWindowEvent } from "../../platform/windows";
import { useBrowser } from "../browser/store";
import { inPinnedContainer, plural, profileFor } from "../browser/model";
import { tabsLostWithWindow } from "../tabs/sharedWindowClose";
import { isLastRegularWindow, isOpenRegularWindow, isSmall } from "./small";
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
  const { decision, suppressWarning, keepsLastWindow } = await decideWindowClose(windowId);
  if (suppressWarning) useBrowser.getState().updateSettings({ warnBeforeClosingWindow: false });
  if (decision === "cancel") return;
  closeWindowAnimated(windowId, { keepsLastWindow });
}

export type CloseAsk = typeof confirm;
export type WindowCloseDecision = { decision: "allow" | "cancel"; suppressWarning: boolean; keepsLastWindow?: boolean };

const allow = (suppressWarning = false): WindowCloseDecision => ({ decision: "allow", suppressWarning });

async function askToClose(windowId: string, ask: CloseAsk, closing?: string[]): Promise<WindowCloseDecision> {
  const { confirmed, suppressed } = await ask({ ...closeWindowDialog(windowId, closing), suppression: "Don’t ask me again", windowId });
  return { decision: confirmed ? "allow" : "cancel", suppressWarning: suppressed };
}

export async function decideWindowClose(windowId: string, ask: CloseAsk = confirm): Promise<WindowCloseDecision> {
  const asked = new Set<string>();
  let suppressWarning = false;
  for (;;) {
    const now = useBrowser.getState();
    if (!now.windows[windowId]) return { decision: "cancel", suppressWarning };
    if (isLastRegularWindow(now, windowId)) return { ...allow(suppressWarning), keepsLastWindow: true };
    const closing = tabsLostWithWindow(now, windowId, isOpenRegularWindow).map((t) => t.id);
    const warns = now.settings.warnBeforeClosingWindow && !suppressWarning;
    if (!warns || closing.length < MIN_TABS || closing.every((id) => asked.has(id))) return allow(suppressWarning);
    const answer = await askToClose(windowId, ask, closing);
    suppressWarning ||= answer.suppressWarning;
    if (answer.decision === "cancel") return { decision: "cancel", suppressWarning };
    for (const id of closing) asked.add(id);
  }
}

export async function decideLastTabClose(windowId: string, ask: CloseAsk = confirm): Promise<WindowCloseDecision> {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (!w || !s.settings.warnBeforeClosingLastTab || w.kind === "private") return allow();
  return askToClose(windowId, ask);
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
