import { call } from "./engine/call";
import type { Download } from "./module";
import type { SiteSettingType } from "./siteSettings";

export type PageEngine = "chromium" | "webkit";

export type PageCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  session: boolean;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  partitionKey?: unknown;
  partitionKeyOpaque?: boolean;
};

export type PasskeyAccessStatus = "entitlementRequired" | "deviceNotConfigured" | "notDetermined" | "authorized" | "denied";
export type PasskeyAccess = { entitled: boolean; status: PasskeyAccessStatus };

export const NO_PASSKEY_ACCESS: PasskeyAccess = { entitled: false, status: "entitlementRequired" };

export const WEBKIT_SITE_SETTINGS: readonly SiteSettingType[] = ["camera", "microphone"];

export function leftDownloadStaging(download: Download): { path: string; uuid: string; folder: string } | null {
  const uuid = download.stagingId ?? (download.id.startsWith("wk-download-") ? download.id.slice("wk-download-".length) : "");
  const destination = download.destination ?? "";
  const folder = destination.slice(0, destination.lastIndexOf("/"));
  return download.staging && uuid && folder && download.state !== "downloading" ? { path: download.staging, uuid, folder } : null;
}

export async function removeLeftDownloadStaging(download: Download): Promise<boolean> {
  const left = leftDownloadStaging(download);
  if (!left) return false;
  return call("webKit.removeDownloadStaging", left);
}
export const endWebKitPrivateSession = (session: string) => call("webKit.endPrivateSession", { session });
export const webKitCookieStoreKey = (profile: string) => call("webKit.cookieStoreKey", { profile });
export const importWebKitCookies = (profile: string, storeKey: string, cookies: PageCookie[]) =>
  call("webKit.importCookies", { profile, storeKey, cookies });
export const getPasskeyAccess = () => call("webKit.passkeyAccess");
export const requestPasskeyAccess = () => call("webKit.requestPasskeyAccess");
