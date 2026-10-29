import { getSiteSettings, setSiteSetting, WEBKIT_SITE_SETTINGS, type SiteSettings, type SiteSettingType, type SiteSettingValue } from "../../platform/siteSettings";
import type { PageEngine } from "../../platform/tabs";
import { currentLive, currentMuteState } from "../browser/current";
import { setSiteMuted } from "../browser/actions";
import { pageOf } from "../tabs/pageState";

export type SitePermission = { type: SiteSettingType; title: string; icon: string; badge: string; choices: SiteSettingValue[] };

const SITE_PERMISSIONS: SitePermission[] = [
  { type: "camera", title: "Camera", icon: "video", badge: "video.fill", choices: ["ask", "allow", "block"] },
  { type: "microphone", title: "Microphone", icon: "mic", badge: "mic.fill", choices: ["ask", "allow", "block"] },
  { type: "location", title: "Location", icon: "location", badge: "location.fill", choices: ["ask", "allow", "block"] },
  { type: "notifications", title: "Notifications", icon: "bell", badge: "bell.fill", choices: ["ask", "allow", "block"] },
  { type: "popups", title: "Pop-ups and Redirects", icon: "macwindow.on.rectangle", badge: "macwindow.on.rectangle", choices: ["allow", "block"] },
  { type: "sound", title: "Sound", icon: "speaker.wave.2", badge: "speaker.wave.2.fill", choices: ["allow", "block"] },
];

export const sitePermissionsFor = (engine: PageEngine) =>
  engine === "webkit" ? SITE_PERMISSIONS.filter((p) => p.type === "sound" || WEBKIT_SITE_SETTINGS.includes(p.type)) : SITE_PERMISSIONS;

export const choiceTitle = (type: SiteSettingType, value: SiteSettingValue) =>
  type === "sound" ? (value === "block" ? "Muted" : "Allowed") : value === "allow" ? "Allowed" : value === "block" ? "Blocked" : "Ask";

export const readSiteSettings = (profile: string, origin: string, engine: PageEngine) =>
  getSiteSettings(profile, origin, engine).catch((): SiteSettings => ({}) as SiteSettings);

export function featuredPermissions(tabId: string, settings: SiteSettings, list: SitePermission[]): Set<SiteSettingType> {
  const access = pageOf(tabId).mediaAccess;
  const inUse: Partial<Record<SiteSettingType, boolean>> = {
    camera: !!access?.camera,
    microphone: !!access?.microphone,
    sound: currentMuteState(tabId) !== null || !!currentLive(tabId)?.playingAudio,
  };
  return new Set(list.filter((p) => !settings[p.type]?.isDefault || inUse[p.type]).map((p) => p.type));
}

export type SiteSound = { siteMuted: boolean; soundBlocked: boolean };

export const permissionValue = (type: SiteSettingType, settings: SiteSettings | null, sound: SiteSound): SiteSettingValue | undefined =>
  type === "sound" ? (sound.siteMuted || sound.soundBlocked ? "block" : "allow") : settings?.[type]?.value;

export async function setSitePermission(
  page: { tabId: string; profile: string; origin: string; engine: PageEngine },
  type: SiteSettingType,
  value: SiteSettingValue,
  sound: SiteSound,
): Promise<SiteSettings | null> {
  if (type === "sound") {
    setSiteMuted(page.tabId, value === "block");
    if (value === "block" || !sound.soundBlocked) return null;
    await setSiteSetting(page.profile, page.origin, "sound", "default", page.engine);
  } else await setSiteSetting(page.profile, page.origin, type, value, page.engine);
  return readSiteSettings(page.profile, page.origin, page.engine);
}

export function blockerLabel(engine: PageEngine, blocker: { enabled: boolean; allowed: boolean } | null, blocked: number): string {
  if (engine === "webkit") return "Chromium only for now";
  if (!blocker) return "…";
  if (!blocker.enabled) return "Off in Settings";
  if (blocker.allowed) return "Off for this site";
  return blocked > 0 ? `On · ${blocked} blocked on this page` : "On";
}
