import { deliverZapPicked, onZapPicked, setZapRelated, startZap, stopZap, type ZapPick } from "../../platform/boostZap";

export { type ZapPick, deliverZapPicked, setZapRelated, startZap, stopZap };

export function watchZapPicks(tabId: string, listener: (pick: ZapPick) => void): () => void {
  const subscription = onZapPicked(tabId, listener);
  return () => subscription.remove();
}
