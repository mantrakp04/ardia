import type { UpdateChannel, UpdaterState } from "../../platform/app";

type SwitchCheck = NonNullable<Extract<UpdaterState, { available: true }>["switchCheck"]>;

const CHANNEL_NAMES: Record<UpdateChannel, string> = { stable: "Stable", nightly: "Nightly" };

export const FOLLOW_EVERY_MS = 400;
export const FOLLOW_FOR_MS = 120_000;

export type SwitchOutcome = "offered" | "upToDate" | "failed";

export function switchOutcome(check: SwitchCheck | null | undefined): SwitchOutcome | null {
  switch (check?.phase) {
    case "found":
      return "offered";
    case "upToDate":
    case "newerThanLatest":
      return "upToDate";
    case "failed":
      return "failed";
    default:
      return null;
  }
}

export function updaterBusy(state: UpdaterState | undefined): boolean {
  if (!state?.available) return false;
  const phase = state.switchCheck?.phase;
  return state.sessionInProgress || phase === "waiting" || phase === "checking";
}

export type CheckNowControl = { title: string; checking: boolean; disabled: boolean; pressable: boolean };

export function checkNowControl(state: UpdaterState | undefined): CheckNowControl {
  const idle = { title: "Check Now", checking: false, disabled: false, pressable: true };
  if (!state?.available || !state.configured) return idle;
  const phase = state.switchCheck?.phase;
  if (phase === "waiting" || phase === "checking") return { title: "Checking…", checking: true, disabled: false, pressable: true };
  if (!state.canCheck && state.sessionInProgress) return { title: "Checking…", checking: true, disabled: false, pressable: false };
  return state.canCheck ? idle : { ...idle, disabled: true, pressable: false };
}

export function switchCheckLine(state: UpdaterState | undefined, app: string): string | null {
  if (!state?.available || !state.switchCheck) return null;
  const { phase, channel, version } = state.switchCheck;
  const name = CHANNEL_NAMES[channel] ?? channel;
  const current = state.displayVersion ?? state.version;
  switch (phase) {
    case "waiting":
      return `Checking ${name} once the current update finishes…`;
    case "checking":
      return `Checking ${name}…`;
    case "found":
      return version ? `${app} ${version} is available on ${name}.` : `An update is available on ${name}.`;
    case "upToDate":
      return `You're up to date on ${name}.`;
    case "newerThanLatest":
      return channel === "stable"
        ? `${current} is newer than the latest Stable, so ${app} stays on it until a newer Stable ships.`
        : `You're up to date on ${name}.`;
    case "failed":
      return `Couldn't check ${name}. Try Check Now.`;
    default:
      return null;
  }
}
