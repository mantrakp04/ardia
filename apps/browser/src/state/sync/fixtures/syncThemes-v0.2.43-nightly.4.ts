import { canonical, type ScopeState } from "@ardia/sync";
import { themeFromRecord } from "../profileAdapters";
import type { ProfileLink } from "../syncDoc";

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
