import { call, NO_PASSKEY_ACCESS, type PageCookie, type PasskeyAccess, type PasskeyAccessStatus } from "@ardia/ardiacore";

export { NO_PASSKEY_ACCESS };
export type { PasskeyAccess, PasskeyAccessStatus, PageCookie };

export const endWebKitPrivateSession = (session: string) => call("webKit.endPrivateSession", { session });
export const webKitCookieStoreKey = (profile: string) => call("webKit.cookieStoreKey", { profile });
export const importWebKitCookies = (profile: string, storeKey: string, cookies: PageCookie[]) =>
  call("webKit.importCookies", { profile, storeKey, cookies });
export const getPasskeyAccess = () => call("webKit.passkeyAccess");
export const requestPasskeyAccess = () => call("webKit.requestPasskeyAccess");
