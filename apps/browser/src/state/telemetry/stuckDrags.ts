export type DragsEnded = { ownerGone: number; debuggerUnowned: number; nativeRefused: number };

const KINDS = ["ownerGone", "debuggerUnowned", "nativeRefused"] as const;
const none = (): DragsEnded => ({ ownerGone: 0, debuggerUnowned: 0, nativeRefused: 0 });

let seen = none();
let pending = none();

export function noteDragsEnded(totals: DragsEnded | undefined) {
  if (!totals) return;
  for (const kind of KINDS) {
    const total = Number(totals[kind]) || 0;
    if (total > seen[kind]) pending[kind] += total - seen[kind];
    seen[kind] = Math.max(seen[kind], total);
  }
}

export function takeStuckDragCounts() {
  const taken = pending;
  pending = none();
  return {
    stuck_drags_ended_owner_gone: taken.ownerGone,
    stuck_drags_ended_debugger: taken.debuggerUnowned,
    stuck_drags_ended_refused: taken.nativeRefused,
  };
}
