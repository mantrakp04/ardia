import type { ProfileRecord } from "./profileAdapters";
import { isFields, isNumber, isString, type Fields } from "../../lib/decode";

export type ShareRecord = { o: string };
export type DeviceRecord = { n: string };
export type DeviceTabs = { n: string; tabs: { u: string; t: string }[] };
export type BookmarkValue = { k: "u" | "f"; p: string; t: string; u?: string; a: number; pos: string };
export type HistoryValue = { t: string; n: number; vt: number[] };
export type PasswordValue = { o: string; u: string; s: string };

export const SHARE = "share:";
export const DEVICE = "dev:";
export const DEVICE_TABS = "tabs:";
export const PROFILE = "prof:";
export const PROFILE_THEME = "pth:";
export const BOOKMARK = "bm:";
export const HISTORY = "h:";

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

export const passwordValue = decoder<PasswordValue>((v) => isString(v.o) && isString(v.u) && isString(v.s));

export const profileRecord = decoder<ProfileRecord>(
  (v) => isString(v.n) && isString(v.c) && (v.i === undefined || v.i === null || isString(v.i)) && (v.d === undefined || v.d === true) && (v.th === undefined || v.th === null || isFields(v.th)),
);
