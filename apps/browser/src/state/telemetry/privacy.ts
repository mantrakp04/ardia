import { anonymousIdentity, type AnonymousIdentity } from "@ardia/core";
import { revealFile } from "../../platform/files";
import { useTelemetry } from "./choice";
import { capture } from "./client";
import { exportLocalCopy } from "./localStore";

export { resetAnonymousId, shortInstallId } from "./identity";
export { stopWatch } from "./watch";

export const useInstallId = () => useTelemetry((s) => s.installId);
export const useWatchReport = () => useTelemetry((s) => s.watchReport);
export const useWatchUntil = () => useTelemetry((s) => s.watchUntil);
export const useWatchTurnedSharingOn = () => useTelemetry((s) => s.sharingUntil !== null);

const shown = new Map<string, AnonymousIdentity>();
export function identityFor(installId: string): AnonymousIdentity {
  let identity = shown.get(installId);
  if (!identity) shown.set(installId, (identity = anonymousIdentity(installId)));
  return identity;
}

export async function viewMyData(): Promise<{ lines: number; path: string } | null> {
  const exported = await exportLocalCopy();
  capture("local_copy_exported", { ok: !!exported, lines: exported?.lines ?? 0, bytes: exported?.bytes ?? 0 });
  if (!exported) return null;
  void revealFile(exported.path).catch(() => false);
  return { lines: exported.lines, path: exported.path };
}
