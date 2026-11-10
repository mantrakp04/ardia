import { visible, type ScopeState } from "../../platform/sync";
import { DEVICE, RECEIVES_TABS, deviceRecord, recordId, type DeviceKind, type DeviceRecord } from "./records";

export const PHONE_SEEN_MS = 30 * 86_400_000;

export const deviceKindOf = (record: { k?: unknown } | null | undefined): DeviceKind => (record?.k === "phone" ? "phone" : "mac");

export const receivesTabs = (record: DeviceRecord | null | undefined) => Array.isArray(record?.f) && record.f.includes(RECEIVES_TABS);

export const isCurrentDevice = (record: DeviceRecord | null | undefined, lastSeen: number | null | undefined, now: number) =>
  deviceKindOf(record) !== "phone" || (typeof lastSeen === "number" && now - lastSeen <= PHONE_SEEN_MS);

export const offersTabs = (record: DeviceRecord | null | undefined, lastSeen: number | null | undefined, now: number) =>
  receivesTabs(record) && isCurrentDevice(record, lastSeen, now);

export function deviceRecords(app: ScopeState): Map<string, DeviceRecord> {
  return new Map(
    [...visible(app, DEVICE)].flatMap(([key, value]) => {
      const record = deviceRecord(value);
      return record ? [[recordId(DEVICE, key), record] as const] : [];
    }),
  );
}

const modelOf = (name: string) => name.split(/[’']s /).slice(1).join("'s ").trim() || name;

export const deviceLabel = (kind: DeviceKind, name: string) => (kind === "phone" ? "iPhone" : modelOf(name));

export function deviceSymbol(kind: DeviceKind, name: string): string {
  if (kind === "phone") return "iphone";
  return /\b(iMac|Mac mini|Mac Studio|Mac Pro)\b/i.test(name) ? "desktopcomputer" : "laptopcomputer";
}
