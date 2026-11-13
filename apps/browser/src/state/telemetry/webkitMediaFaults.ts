export const MEDIA_FAULT_REASONS = [
  ...(["widevine", "playready", "fairplay", "other"] as const).flatMap((system) =>
    (["granted", "refused_not_supported", "refused_security", "refused_not_allowed", "refused_other"] as const).map((answer) => `eme_${system}_${answer}`),
  ),
  "media_error_aborted",
  "media_error_network",
  "media_error_decode",
  "media_error_src_not_supported",
  "play_rejected_not_allowed",
  "play_rejected_not_supported",
  "play_rejected_abort",
  "play_rejected_other",
];

export type WebKitMediaFault = { reason: string; muted?: boolean; blockerActive?: boolean };

type Tally = { reasons: Map<string, number>; muted: number; blockerActive: number };

const known = new Set(MEDIA_FAULT_REASONS);
const empty = (): Tally => ({ reasons: new Map(), muted: 0, blockerActive: 0 });

let pending = empty();
const session = empty();

export function noteWebKitMediaFault(fault: WebKitMediaFault) {
  if (typeof fault?.reason !== "string" || !known.has(fault.reason)) return;
  for (const tally of [pending, session]) {
    tally.reasons.set(fault.reason, (tally.reasons.get(fault.reason) ?? 0) + 1);
    if (fault.muted === true) tally.muted++;
    if (fault.blockerActive === true) tally.blockerActive++;
  }
}

const keys = (tally: Tally) => {
  const out: Record<string, number> = {};
  for (const reason of MEDIA_FAULT_REASONS) if (tally.reasons.has(reason)) out[`webkit_fault_${reason}`] = tally.reasons.get(reason)!;
  if (tally.muted) out.webkit_faults_muted = tally.muted;
  if (tally.blockerActive) out.webkit_faults_blocker_active = tally.blockerActive;
  return out;
};

export function takeWebKitMediaFaultCounts() {
  const taken = keys(pending);
  pending = empty();
  return taken;
}

export function webKitMediaFaultsLine() {
  const total = keys(session);
  const parts = Object.entries(total).map(([key, count]) => `${key.replace(/^webkit_faults?_/, "")} ${count}`);
  return `WebKit media faults this session: ${parts.length ? parts.join(", ") : "none"}`;
}
