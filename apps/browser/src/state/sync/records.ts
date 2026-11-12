import type { BookmarkValue, DeviceTabs, HistoryValue, SendRecord } from "../../platform/sync";
import type { ProfileRecord } from "./profileAdapters";
import { isFields, isNumber, isString, type Fields } from "../../lib/decode";

export type { BookmarkValue, DeviceTabs, HistoryValue, SendRecord };
export type ShareRecord = { o: string };
export type DeviceKind = "mac" | "phone";
export type DeviceRecord = { n: string; k?: string; f?: string[] };
export type PasswordValue = { o: string; u: string; s: string };
export type TopAppsRecord = { on: boolean };

export const SHARE = "share:";
export const DEVICE = "dev:";
export const DEVICE_TABS = "tabs:";
export const PROFILE = "prof:";
export const PROFILE_THEME = "pth:";
export const PROFILE_TOP_APPS = "pta:";
export const BOOKMARK = "bm:";
export const HISTORY = "h:";
export const SEND = "send:";

export const RECEIVES_TABS = "send";

export const recordId = (prefix: string, key: string) => key.slice(prefix.length);
export const profileScope = (syncId: string) => `p:${syncId}`;

const decoder =
  <T,>(valid: (v: Fields) => boolean) =>
  (v: unknown): T | null =>
    isFields(v) && valid(v) ? (v as T) : null;

export const shareRecord = decoder<ShareRecord>((v) => isString(v.o));

export const deviceRecord = decoder<DeviceRecord>((v) => isString(v.n));

export const deviceTabs = decoder<DeviceTabs>((v) => isString(v.n) && Array.isArray(v.tabs) && v.tabs.every((t) => isFields(t) && isString(t.u) && isString(t.t)));

export const bookmarkValue = decoder<BookmarkValue>(
  (v) => (v.k === "u" || v.k === "f") && isString(v.p) && isString(v.t) && (v.u === undefined || isString(v.u)) && isNumber(v.a) && isString(v.pos),
);

export const historyValue = decoder<HistoryValue>((v) => isString(v.t) && isNumber(v.n) && Array.isArray(v.vt) && v.vt.every(isNumber));

const MAX_SENT_TITLE = 500;

export function sendRecord(value: unknown): SendRecord | null {
  if (!isFields(value)) return null;
  const { u, t, to, from, at } = value;
  if (!isString(to) || !isString(from)) return null;
  return { u: isString(u) ? u : "", t: isString(t) ? t.slice(0, MAX_SENT_TITLE) : "", to, from, at: isNumber(at) ? at : 0 };
}

export const passwordValue = decoder<PasswordValue>((v) => isString(v.o) && isString(v.u) && isString(v.s));

export const profileRecord = decoder<ProfileRecord>(
  (v) => isString(v.n) && isString(v.c) && (v.i === undefined || v.i === null || isString(v.i)) && (v.d === undefined || v.d === true) && (v.o === undefined || v.o === true) && (v.th === undefined || v.th === null || isFields(v.th)),
);

export const topAppsRecord = decoder<TopAppsRecord>((v) => typeof v.on === "boolean");
