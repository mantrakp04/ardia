import { AppState, type GestureResponderEvent } from "react-native";
import { modifiersOf } from "../../lib/keys";
import { activeTabId } from "../browser/model";
import { useBrowser } from "../browser/store";
import { focusedWindowOf } from "../windows/ui";
import { clickTab } from "./actions";
import { dismissHover } from "./hover";
import { notePressEnded, notePressOut, notePressStarted, type TabPressDrift, type TabPressDrop } from "../telemetry/tabPresses";

export const TAB_CLICK_SLOP = 10;

export const devTabPress = { switchOnPress: true };

export type TabPress = {
  windowId: string;
  tabId: string;
  startedAt: number | undefined;
  switched: boolean;
  at: { x: number; y: number } | null;
  windowKey: boolean;
  answered: boolean;
  out: boolean;
};

let heldPress: TabPress | null = null;

type WithHistory = GestureResponderEvent & { touchHistory?: { touchBank: ({ startTimeStamp: number } | null | undefined)[] } };

const pressStart = (e: GestureResponderEvent) => (e as WithHistory).touchHistory?.touchBank[Number(e.nativeEvent.identifier)]?.startTimeStamp;

const pointOf = (e: GestureResponderEvent) => {
  const { pageX, pageY } = e.nativeEvent;
  return Number.isFinite(pageX) && Number.isFinite(pageY) ? { x: pageX, y: pageY } : null;
};

const windowIsKey = (windowId: string) => AppState.currentState === "active" && focusedWindowOf(useBrowser.getState()) === windowId;

function driftBetween(from: TabPress["at"], to: TabPress["at"]): TabPressDrift {
  if (!from || !to) return "unknown";
  const far = Math.hypot(to.x - from.x, to.y - from.y);
  return far < 5 ? "lt5" : far < TAB_CLICK_SLOP ? "5_9" : "10_plus";
}

function switchesOnPress(windowId: string, tabId: string, press: GestureResponderEvent) {
  if (!devTabPress.switchOnPress) return false;
  const mods = modifiersOf(press);
  if (mods.metaKey || mods.altKey || mods.shiftKey || (press.nativeEvent as { ctrlKey?: boolean }).ctrlKey) return false;
  const s = useBrowser.getState();
  if (!s.tabs[tabId] || activeTabId(s, windowId) === tabId) return false;
  return !(s.selection[windowId] ?? []).includes(tabId);
}

export function holdTabPress(windowId: string, tabId: string, press: GestureResponderEvent) {
  const switched = switchesOnPress(windowId, tabId, press);
  const held: TabPress = { windowId, tabId, startedAt: pressStart(press), switched, at: pointOf(press), windowKey: windowIsKey(windowId), answered: false, out: false };
  heldPress = held;
  notePressStarted(switched, held.windowKey);
  if (switched) {
    dismissHover();
    clickTab(windowId, tabId);
  }
  return held;
}

export function clickHeldTabPress(windowId: string, tabId: string, release: GestureResponderEvent, press: TabPress | null = null) {
  const held = heldPress;
  heldPress = null;
  if (press) press.answered = true;
  notePressEnded("click", tabId);
  dismissHover();
  const start = pressStart(release);
  if (held?.switched && held.tabId === tabId && start !== undefined && held.startedAt === start) return;
  clickTab(windowId, tabId, modifiersOf(release));
}

export function pressOutTabPress(press: TabPress | null, e: GestureResponderEvent) {
  if (!press || press.out) return;
  press.out = true;
  const drift = driftBetween(press.at, pointOf(e));
  setTimeout(() => notePressOut(drift, !press.answered, press.windowKey), 0);
}

export function endHeldTabPress(tabIds: string[], release: GestureResponderEvent | null) {
  const held = heldPress;
  heldPress = null;
  if (!held) return;
  const dropped = (why: TabPressDrop) => notePressEnded("drag", null, why);
  if (!release) return dropped("no_release");
  if (!tabIds.includes(held.tabId)) return dropped("not_dragged");
  if (held.startedAt === undefined) return dropped("no_start");
  if (held.startedAt !== pressStart(release)) return dropped("start_mismatch");
  notePressEnded("dragClick", held.tabId);
  dismissHover();
  if (!held.switched) clickTab(held.windowId, held.tabId, modifiersOf(release));
}
