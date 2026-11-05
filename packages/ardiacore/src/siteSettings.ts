export type SiteSettingType =
  | "popups" | "camera" | "microphone" | "location" | "notifications" | "sound" | "autoplay" | "javascript"
  | "images" | "clipboard" | "automaticDownloads" | "cookies" | "midi" | "sensors" | "windowManagement"
  | "localFonts" | "idleDetection" | "storageAccess" | "fileSystem" | "keyboardLock" | "pointerLock"
  | "cameraPanTiltZoom";

export type SiteSettingValue = "allow" | "block" | "ask" | "default";

export type SiteSettings = Record<SiteSettingType, { value: SiteSettingValue; isDefault: boolean }>;
export type ClearSiteDataResult = { cookies: number | false; storage: boolean };
