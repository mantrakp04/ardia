import { canonical, type ScopeState } from "../../platform/sync";
import { useBrowser } from "../browser/store";
import type { Profile } from "../browser/types";
import { legacyThemeOf, themeAngleKey, themeFromRecord, type ProfileRecord } from "./profileAdapters";
import type { ProfileLink } from "./syncDoc";

function pairedTheme(app: ScopeState, syncId: string): Pick<Profile, "theme"> | null {
  const record = app.records[`pth:${syncId}`]?.v;
  if (record) return themeFromRecord(record, app.records[themeAngleKey(syncId)]?.v);
  const profile = app.records[`prof:${syncId}`]?.v as ProfileRecord | null | undefined;
  return profile ? legacyThemeOf(profile) : null;
}

function settledTheme(app: ScopeState, syncId: string): boolean {
  const record = app.records[`pth:${syncId}`]?.v;
  return !!record && !!themeFromRecord(record);
}

export function pairTheme(app: ScopeState, profileId: string, link: ProfileLink) {
  const theme = pairedTheme(app, link.syncId);
  if (theme) useBrowser.getState().updateProfile(profileId, theme);
  if (settledTheme(app, link.syncId)) delete link.themeAdopting;
  else link.themeAdopting = true;
}

export function settleAppliedThemes(profiles: Record<string, ProfileLink>, app: ScopeState | undefined) {
  if (!app) return;
  for (const link of Object.values(profiles)) {
    if (!link.themeAdopting) continue;
    const key = `pth:${link.syncId}`;
    const record = app.records[key]?.v;
    if (record && themeFromRecord(record) && app.base[key] === canonical(record)) delete link.themeAdopting;
  }
}

export function confirmThemes(profiles: Record<string, ProfileLink>, app: ScopeState) {
  settleAppliedThemes(profiles, app);
  if (app.pending > 0 || Object.keys(app.damaged).length > 0) return;
  if (Object.values(app.files).some((f) => f.k === "bad")) return;
  for (const link of Object.values(profiles)) {
    if (!link.themeAdopting) continue;
    const record = app.records[`pth:${link.syncId}`];
    if (!record || record.v === null) delete link.themeAdopting;
  }
}
