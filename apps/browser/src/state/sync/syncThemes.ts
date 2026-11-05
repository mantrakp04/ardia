import { canonical, pullSettled, type ScopeState } from "../../platform/sync";
import { useBrowser } from "../browser/store";
import type { Profile } from "../browser/types";
import { legacyThemeOf, themeAngleKey, themeFromRecord, type ProfileRecord } from "./profileAdapters";
import { PROFILE, PROFILE_THEME, profileRecord } from "./records";
import type { ProfileLink } from "./syncDoc";

function pairedTheme(app: ScopeState, syncId: string): Pick<Profile, "theme"> | null {
  const record = app.records[`${PROFILE_THEME}${syncId}`]?.v;
  if (record) return themeFromRecord(record, app.records[themeAngleKey(syncId)]?.v);
  const profile = profileRecord(app.records[`${PROFILE}${syncId}`]?.v);
  return profile ? legacyThemeOf(profile) : null;
}

function settledTheme(app: ScopeState, syncId: string): boolean {
  const record = app.records[`${PROFILE_THEME}${syncId}`]?.v;
  return !!record && !!themeFromRecord(record);
}

export function pairTheme(app: ScopeState | undefined, profileId: string, link: ProfileLink, record?: ProfileRecord) {
  const theme = app ? pairedTheme(app, link.syncId) : record ? legacyThemeOf(record) : null;
  if (theme) useBrowser.getState().setProfileLook(profileId, theme);
  if (app && settledTheme(app, link.syncId)) delete link.themeAdopting;
  else link.themeAdopting = true;
}

export function themeChosenHere(link: ProfileLink | undefined): boolean {
  if (!link?.themeAdopting) return false;
  delete link.themeAdopting;
  return true;
}

export function settleThemeAdoption(profiles: Record<string, ProfileLink>, app: ScopeState | undefined, afterPull: boolean) {
  if (!app) return;
  const clean = afterPull && pullSettled(app);
  for (const link of Object.values(profiles)) {
    if (!link.themeAdopting) continue;
    const key = `${PROFILE_THEME}${link.syncId}`;
    const record = app.records[key]?.v;
    const applied = !!record && !!themeFromRecord(record) && app.base[key] === canonical(record);
    const absent = clean && (record === undefined || record === null);
    if (applied || absent) delete link.themeAdopting;
  }
}
