import { sameSite } from "./originMatch";

export const PENDING_TOTP_MS = 3 * 60_000;

export type PendingTotp = { origin: string; provider: string; id: string; at: number };

export const livePending = (list: readonly PendingTotp[], now: number) => list.filter((p) => now - p.at < PENDING_TOTP_MS && now >= p.at);

export const rememberPending = (list: readonly PendingTotp[], entry: PendingTotp): PendingTotp[] => [
  ...livePending(list, entry.at).filter((p) => !sameSite(p.origin, entry.origin)),
  entry,
];

export function pendingFor(list: readonly PendingTotp[], origin: string, now: number): PendingTotp | null {
  const live = livePending(list, now).filter((p) => sameSite(p.origin, origin));
  return live.sort((a, b) => b.at - a.at)[0] ?? null;
}

export const forgetPending = (list: readonly PendingTotp[], provider?: string) => (provider ? list.filter((p) => p.provider !== provider) : []);
