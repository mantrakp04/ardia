import type { AdoptId, AdoptKind, Tab } from "../browser/types";
import { wakeOf } from "./pageSession";

const KINDS: readonly AdoptKind[] = ["restore", "clone", "tab", "ardiacore", "webkit", "link"];

export const restoreId = (tabId: string): AdoptId => `restore:${tabId}`;
export const cloneId = (tabId: string): AdoptId => `clone:${tabId}`;

export function adoptKind(id: string | undefined): { kind: AdoptKind; key: string } | null {
  const colon = id?.indexOf(":") ?? -1;
  if (!id || colon < 0) return null;
  const kind = id.slice(0, colon) as AdoptKind;
  return KINDS.includes(kind) ? { kind, key: id.slice(colon + 1) } : null;
}

export const asAdoptId = (id: string | undefined): AdoptId | undefined => (adoptKind(id) ? (id as AdoptId) : undefined);

export const isAdoptKind = (id: string | undefined, kind: AdoptKind) => adoptKind(id)?.kind === kind;

export function pendingRestore(t: Tab | undefined): string | undefined {
  const id = adoptKind(wakeOf(t));
  return id?.kind === "restore" ? id.key : undefined;
}
