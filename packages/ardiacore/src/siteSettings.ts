import { call } from "./engine/call";
import type { PageEngine } from "./webkit";

export type SiteSettingType =
  | "popups" | "camera" | "microphone" | "location" | "notifications" | "sound" | "autoplay" | "javascript"
  | "images" | "clipboard" | "automaticDownloads" | "cookies" | "midi" | "sensors" | "windowManagement"
  | "localFonts" | "idleDetection" | "storageAccess" | "fileSystem" | "keyboardLock" | "pointerLock"
  | "cameraPanTiltZoom";

export type SiteSettingValue = "allow" | "block" | "ask" | "default";

export type SiteSettings = Record<SiteSettingType, { value: SiteSettingValue; isDefault: boolean }>;
export type ClearSiteDataResult = { cookies: number | false; storage: boolean };

export const setSiteSetting = (profile: string, origin: string, type: SiteSettingType, value: SiteSettingValue, engine: PageEngine = "chromium") =>
  call("sites.setSetting", { profile, origin, type, value, engine });
export const getSiteSettings = (profile: string, origin: string, engine: PageEngine = "chromium") => call("sites.settings", { profile, origin, engine });
export const getSiteSettingsOrigins = (profile: string) => call("sites.origins", { profile });
export const resetSiteSettings = (profile: string, origin: string) => call("sites.reset", { profile, origin });
export const clearSiteData = (profile: string, origin: string) => call("sites.clearData", { profile, origin });
