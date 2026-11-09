import {
  call,
  WEBKIT_SITE_SETTINGS,
  type ClearSiteDataResult,
  type ExternalAppRequest,
  type PageEngine,
  type SiteSettings,
  type SiteSettingType,
  type SiteSettingValue,
} from "@ardia/ardiacore";

export { WEBKIT_SITE_SETTINGS };
export type { ExternalAppRequest, SiteSettingType, SiteSettingValue, SiteSettings, ClearSiteDataResult };

export const setSiteSetting = (profile: string, origin: string, type: SiteSettingType, value: SiteSettingValue, engine: PageEngine = "chromium") =>
  call("sites.setSetting", { profile, origin, type, value, engine });
export const getSiteSettings = (profile: string, origin: string, engine: PageEngine = "chromium") => call("sites.settings", { profile, origin, engine });
export const getSiteSettingsOrigins = (profile: string) => call("sites.origins", { profile });
export const resetSiteSettings = (profile: string, origin: string) => call("sites.reset", { profile, origin });
export const clearSiteData = (profile: string, origin: string, engine: PageEngine = "chromium") =>
  call("sites.clearData", { profile, origin, engine });

export const setZoom = (profile: string, host: string, zoom: number) => call("sites.setZoom", { profile, host, zoom });
export const getZoomLevels = (profile: string) => call("sites.zoomLevels", { profile });
export const setCommandScrollZoom = (enabled: boolean) => call("webView.setCommandScrollZoom", { enabled });

export const resolveExternalApp = (id: string, open: boolean, remember = false) => call("permissions.resolveExternalApp", { id, open, remember });
export const getExternalAppAllowances = (profile: string) => call("permissions.externalAppAllowances", { profile });
export const removeExternalAppAllowance = (profile: string, origin: string, scheme: string) =>
  call("permissions.removeExternalAppAllowance", { profile, origin, scheme }).then(() => {});
