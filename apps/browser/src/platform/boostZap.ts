import type { ZapPick } from "@ardia/ardiacore";
import { webviews } from "./webviews";

export type { ZapPick };

const listeners = new Map<string, Set<(pick: ZapPick) => void>>();

export const startZap = (tabId: string) => webviews.get(tabId)?.zap("start");

export const stopZap = (tabId: string) => webviews.get(tabId)?.zap("stop");

export const setZapRelated = (tabId: string, level: number) => webviews.get(tabId)?.zap("related", level);

export function onZapPicked(tabId: string, listener: (pick: ZapPick) => void) {
  let mine = listeners.get(tabId);
  if (!mine) listeners.set(tabId, (mine = new Set()));
  mine.add(listener);
  return {
    remove() {
      mine.delete(listener);
      if (!mine.size && listeners.get(tabId) === mine) listeners.delete(tabId);
    },
  };
}

export const deliverZapPicked = (tabId: string, pick: ZapPick) => listeners.get(tabId)?.forEach((listener) => listener(pick));
