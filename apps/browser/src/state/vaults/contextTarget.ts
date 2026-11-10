import type { VaultFillField, VaultFillTarget } from "../../platform/vaults";

type ContextPick = { menuSeq: number; fields: VaultFillField[] };

const picks = new Map<string, ContextPick>();

export const CONTEXT_TARGET: VaultFillTarget = "contextMenu";

export const markContextPick = (tabId: string, menuSeq: number, fields: VaultFillField[]) => void picks.set(tabId, { menuSeq, fields });

export function contextPickOf(tabId: string, menuSeq: number): { fields: VaultFillField[]; target: VaultFillTarget; submit: false } | null {
  const pick = picks.get(tabId);
  if (!pick || pick.menuSeq !== menuSeq) return null;
  return { fields: pick.fields, target: CONTEXT_TARGET, submit: false };
}

export const contextTargetOf = (tabId: string, menuSeq: number): { target?: VaultFillTarget } =>
  picks.get(tabId)?.menuSeq === menuSeq ? { target: CONTEXT_TARGET } : {};

export const forgetContextPick = (tabId: string) => void picks.delete(tabId);
