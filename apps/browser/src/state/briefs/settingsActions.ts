import { useBrowser } from "../browser/store";
import { focus } from "../browser/actions";
import { localBriefDate } from "../../lib/briefDates";
import { openDailyBrief } from "./dailyBriefs";

function browserWindow() {
  const state = useBrowser.getState();
  return state.ui.focusOrder.find((id) => state.windows[id] && !state.windows[id]!.incognito && state.windows[id]!.kind !== "small")
    ?? state.windowOrder.find((id) => !state.windows[id]!.incognito && state.windows[id]!.kind !== "small")
    ?? state.createWindow();
}

export function openBriefAuthorization(url: string) {
  const id = browserWindow();
  useBrowser.getState().newTab(id, { url });
  focus(id);
}

export function openTodayBrief() {
  const id = browserWindow();
  openDailyBrief(id, localBriefDate());
  focus(id);
}

export function setBriefSourcePermission(source: "gmail" | "calendar" | "github", allowed: boolean) {
  const state = useBrowser.getState();
  state.updateSettings({ dailyBriefSources: { ...state.settings.dailyBriefSources, [source]: allowed } });
}

export function saveGmailBriefPermission(connected: boolean, allowed: boolean, provider: string) {
  const state = useBrowser.getState();
  const currentProvider = state.settings.dailyBriefProvider === "claude" ? "Claude" : "ChatGPT";
  setBriefSourcePermission("gmail", connected && allowed && provider === currentProvider);
}
