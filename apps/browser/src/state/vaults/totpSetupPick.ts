import type { VaultItem } from "../../platform/vaults";

type CodePick = { menuSeq: number; onPick: (item: VaultItem) => void };

const picks = new Map<string, CodePick>();

export const markCodePick = (tabId: string, menuSeq: number, onPick: (item: VaultItem) => void) => void picks.set(tabId, { menuSeq, onPick });

export function takeCodePick(tabId: string, menuSeq: number): ((item: VaultItem) => void) | null {
  const pick = picks.get(tabId);
  if (!pick || pick.menuSeq !== menuSeq) return null;
  picks.delete(tabId);
  return pick.onPick;
}

export const forgetCodePick = (tabId: string) => void picks.delete(tabId);
