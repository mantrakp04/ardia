import type { GestureResponderEvent } from "react-native";
import { modifiersOf } from "../../lib/keys";
import { clickTab } from "./actions";
import { dismissHover } from "./hover";

export const TAB_CLICK_SLOP = 10;

let heldPress: { windowId: string; tabId: string; startedAt: number | undefined } | null = null;

type WithHistory = GestureResponderEvent & { touchHistory?: { touchBank: ({ startTimeStamp: number } | null | undefined)[] } };

const pressStart = (e: GestureResponderEvent) => (e as WithHistory).touchHistory?.touchBank[Number(e.nativeEvent.identifier)]?.startTimeStamp;

export function holdTabPress(windowId: string, tabId: string, press: GestureResponderEvent) {
  heldPress = { windowId, tabId, startedAt: pressStart(press) };
}

export function endHeldTabPress(tabIds: string[], release: GestureResponderEvent | null) {
  const held = heldPress;
  heldPress = null;
  if (!held || !release || !tabIds.includes(held.tabId) || held.startedAt === undefined || held.startedAt !== pressStart(release)) return;
  dismissHover();
  clickTab(held.windowId, held.tabId, modifiersOf(release));
}
