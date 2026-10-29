import type { ScopeState } from "./scopeState.ts";

export type PulledFiles = { read: string[]; unreadable: string[]; pending: string[]; present: Set<string> };

export function noteFileHealth(state: ScopeState, files: PulledFiles, now: number, giveUp: number) {
  for (const id of files.read) delete state.damaged[id];
  for (const id of files.unreadable) {
    const since = Math.min(state.damaged[id] ?? now, now);
    if (now - since > giveUp) {
      state.files[id] = { d: "", k: "bad", at: now };
      delete state.damaged[id];
    } else {
      state.damaged[id] = since;
    }
  }
  for (const id of Object.keys(state.damaged)) if (!files.present.has(id)) delete state.damaged[id];
  state.pending = files.pending.length;
  if (files.pending.length) state.pendingSince = Object.fromEntries(files.pending.map((id) => [id, Math.min(state.pendingSince?.[id] ?? now, now)]));
  else delete state.pendingSince;
}

export const holdsBack = (state: ScopeState, now: number, window: number) =>
  Object.keys(state.damaged).length > 0 || Object.values(state.pendingSince ?? {}).some((at) => now - at <= window);

export const pullSettled = (state: ScopeState) =>
  state.pending === 0 && Object.keys(state.damaged).length === 0 && !Object.values(state.files).some((f) => f.k === "bad");
