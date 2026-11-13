import { anonymousIdentity, type AnonymousAvatar } from "@ardia/core";
import { capture, ensureInstallId, replaceInstallId } from "./client";
import { savedChoice, sessionId } from "./choice";
import { uuidv4 } from "./ids";
import { clearLocalCopy } from "./localStore";
import { stopWatch } from "./watch";
import { telemetryRelay } from "./relay";

export type { AnonymousAvatar };

export type TelemetryIdentity = { installId: string | null; sessionId: string; name: string | null; avatar: AnonymousAvatar | null };

export function telemetryIdentity(): TelemetryIdentity {
  const { installId } = savedChoice();
  const shown = installId ? anonymousIdentity(installId) : null;
  return { installId, sessionId: sessionId(), name: shown?.name ?? null, avatar: shown?.avatar ?? null };
}

export type ReportIdentity = { id: string; kind: "install" | "one-time"; name: string; avatar: AnonymousAvatar };

export function reportIdentity(watch: boolean): ReportIdentity {
  const { sharing } = savedChoice();
  const id = sharing || watch ? ensureInstallId() : uuidv4();
  const shown = anonymousIdentity(id);
  return { id, kind: sharing || watch ? "install" : "one-time", name: shown.name, avatar: shown.avatar };
}

export const shortInstallId = (id: string) => id.slice(0, 8);

export async function resetAnonymousId(): Promise<string> {
  const relay = telemetryRelay();
  if (relay) return relay.resetId();
  stopWatch();
  await clearLocalCopy();
  const installId = replaceInstallId();
  capture("anonymous_id_reset");
  return installId;
}
