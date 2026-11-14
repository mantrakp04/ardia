import type { ConnectResult, PhraseCheck, SyncedDevice, SyncedProfile, SyncedView, SyncPhase, SyncStatus } from "../../platform/sync.ts";

export const MAC_HINT = "On your Mac: Settings › Sync › Connect Another Device.";
export const YOUR_MAC = "Your Mac";
export const JUST_NOW_MS = 60_000;

export type StatusLine = { text: string; isWarning: boolean };

export const isSyncOff = (status: SyncStatus) => status.phase === "off";

export function isSyncConnected(status: SyncStatus): boolean {
  switch (status.phase) {
    case "starting":
    case "updating":
    case "updated":
    case "stalled":
    case "offline":
    case "needsFolderAccess":
      return status.isEnabled;
    default:
      return false;
  }
}

export function syncRowSubtitle(status: SyncStatus): StatusLine {
  switch (status.attention) {
    case "folder":
      return { text: "Choose Your Sync Folder Again", isWarning: true };
    case "phrase":
      return { text: "Enter Your Recovery Phrase", isWarning: true };
    case "reset":
      return { text: "Out of Sync", isWarning: true };
    case "stalled":
      return { text: status.statusText, isWarning: true };
    default:
      return { text: isSyncOff(status) ? "Every tab, anywhere." : status.statusText, isWarning: false };
  }
}

export function syncHeroSubtitle(status: SyncStatus): StatusLine {
  if (isSyncOff(status)) return { text: "Your Mac’s tabs here, and this phone’s on your Mac.", isWarning: false };
  return { text: status.statusText, isWarning: status.attention !== "none" };
}

export const bannerNeedsAction = (phase: SyncPhase) => phase === "needsFolderAccess" || phase === "locked" || phase === "reset";

export type BannerIcon = "folder" | "lock" | "reset" | "warning" | "offline";

const BANNER_ICONS: Partial<Record<SyncPhase, BannerIcon>> = {
  needsFolderAccess: "folder",
  locked: "lock",
  reset: "reset",
  stalled: "warning",
  offline: "offline",
};

export function syncBanner(status: SyncStatus): { icon: BannerIcon; text: string; needsAction: boolean } | null {
  const icon = BANNER_ICONS[status.phase];
  return icon ? { icon, text: status.statusText, needsAction: bannerNeedsAction(status.phase) } : null;
}

export function connectMessage(result: ConnectResult): string | null {
  switch (result.result) {
    case "connected":
    case "cancelled":
      return null;
    case "invalidPhrase":
      return result.problem;
    case "mismatch":
      return "This recovery phrase doesn’t match the synced data in this folder. Check the phrase, or choose the folder your other devices sync to.";
    case "noSyncData":
      return "There’s no synced data in this folder yet. Choose the folder your other devices sync to, or wait for it to finish downloading.";
    case "folderUnavailable":
      return "Ardia can’t open this folder. Choose the Ardia Sync folder your Mac syncs to.";
    case "keyStoreFailed":
      return "Couldn’t save the sync key on this phone.";
    case "busy":
      return "Ardia is still turning off sync. Try again in a moment.";
  }
}

export type PhraseTone = "hint" | "problem" | "good";

export function phraseFooter(check: PhraseCheck): { text: string; tone: PhraseTone } {
  if (check.problem) return { text: check.problem, tone: "problem" };
  if (check.isValid) return { text: "All 24 words check out.", tone: "good" };
  return { text: MAC_HINT, tone: "hint" };
}

export const orderedDevices = (devices: readonly SyncedDevice[]): SyncedDevice[] =>
  [...devices].sort((a, b) => Number(a.isCurrent) - Number(b.isCurrent) || (b.lastSeen ?? -Infinity) - (a.lastSeen ?? -Infinity));

const UNITS: [number, string][] = [
  [365 * 86_400, "year"],
  [30 * 86_400, "month"],
  [7 * 86_400, "week"],
  [86_400, "day"],
  [3_600, "hour"],
  [60, "minute"],
];

export function ago(then: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  const [size, unit] = UNITS.find(([span]) => seconds >= span) ?? [1, "second"];
  const count = Math.floor(seconds / size);
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

export function deviceSeen(device: SyncedDevice, now: number): string {
  if (device.isCurrent) return "This Phone";
  if (device.lastSeen === null) return "Not Yet Synced";
  if (now - device.lastSeen < JUST_NOW_MS) return "Just Now";
  return ago(device.lastSeen, now);
}

export type DeviceIcon = "phone" | "laptop" | "desktop";

export function deviceIcon(kind: string, name: string): DeviceIcon {
  if (kind === "phone") return "phone";
  return name.toLowerCase().includes("macbook") ? "laptop" : "desktop";
}

export function profileOf(view: SyncedView, id: string | null): SyncedProfile | null {
  return view.profiles.find((p) => p.syncId === id) ?? view.profiles.find((p) => p.isDefault) ?? view.profiles[0] ?? null;
}

export function sendReceivers(view: SyncedView, profileId: string | null): SyncedDevice[] {
  const profile = view.profiles.find((p) => p.syncId === profileId);
  if (!profile) return [];
  return (profile.sendTargets ?? []).flatMap((id) => view.devices.filter((d) => d.id === id && d.canReceiveTabs && !d.isCurrent));
}

export function receivedSender(senders: readonly (string | null)[]): string {
  const names = new Set(senders.map((name) => name?.trim() ?? "").filter((name) => name.length > 0));
  return names.size === 1 ? [...names][0]! : YOUR_MAC;
}

export const receivedToast = (sender: string, count: number) => (count === 1 ? `Tab from ${sender}` : `${count} Tabs from ${sender}`);

export const sentToast = (device: string) => `Sent to ${device}`;

export const couldNotSendToast = (device: string) => `Couldn’t Send to ${device}`;

export const PINNED_TOAST = "Pinned to Your Mac";
export const COULD_NOT_PIN_TOAST = "Couldn’t Pin to Your Mac";
export const SYNC_TO_PIN_TOAST = "Sync With Your Mac to Pin Tabs";
export const CONNECTED_TOAST = "Syncing With Your Mac";

export function syncedEngineName(
  search: { engineId: string; customEngines: { id: string; name: string }[] },
  engines: readonly { id: string; name: string }[],
): string {
  const custom = search.customEngines.find((engine) => engine.id === search.engineId);
  if (custom) return custom.name;
  if (search.engineId === "custom") return "Custom";
  return engines.find((engine) => engine.id === search.engineId)?.name ?? search.engineId.charAt(0).toUpperCase() + search.engineId.slice(1);
}

function rgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function matchedColor<K extends string>(
  profile: Pick<SyncedProfile, "color" | "theme"> | null,
  swatches: readonly { key: K; hex: string }[],
): K | null {
  if (!profile) return null;
  const named = swatches.find((swatch) => swatch.key === profile.color?.toLowerCase());
  if (named) return named.key;
  const target = rgb(profile.color ?? "") ?? rgb(profile.theme?.colors[0] ?? "");
  if (!target) return null;
  let best: { key: K; distance: number } | null = null;
  for (const swatch of swatches) {
    const color = rgb(swatch.hex);
    if (!color) continue;
    const distance = color.reduce((sum, channel, i) => sum + (channel - target[i]!) ** 2, 0);
    if (!best || distance < best.distance) best = { key: swatch.key, distance };
  }
  return best?.key ?? null;
}

export const INBOX_RETRY = "Sync couldn’t read some changes your Mac sent and set that file aside. Sync Now tries again.";

export function inboxNotice(status: SyncStatus): { message: string; footer: string } | null {
  const problem = status.inboxProblem?.trim();
  if (!problem) return null;
  return { message: problem, footer: INBOX_RETRY };
}

export const SCAN_REJECTED = "Not an Ardia sync code.";

export type ScanVerdict = { kind: "accept"; phrase: string } | { kind: "reject" } | { kind: "repeat" };

export function scanJudge(isValid: (payload: string) => boolean) {
  let last: string | null = null;
  return (payload: string): ScanVerdict => {
    if (payload === last) return { kind: "repeat" };
    last = payload;
    return isValid(payload) ? { kind: "accept", phrase: payload.trim() } : { kind: "reject" };
  };
}
