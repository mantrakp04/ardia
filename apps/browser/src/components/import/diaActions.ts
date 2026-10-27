import { importDiaProfile } from "../../state/import/apply";
import { diaProfilesFor } from "../../state/import/diaTabs";
import type { ImportApi } from "./importActions";
import { APP, type BrowserProfile, type DiaTabsResult, type ImportKind } from "./model";

export type AppTabs = { result: DiaTabsResult } | { note: string };

export const APP_TAB_KINDS: ImportKind[] = ["tabs", "pinnedTabs"];

const NOT_BROUGHT = "Dia's tabs couldn't be brought over:";

export function readAppTabs(api: ImportApi): Promise<AppTabs> {
  return api.readDiaTabs().then(
    (result): AppTabs => (result.windowCount ? { result } : { note: `${NOT_BROUGHT} Dia had no windows open.` }),
    (e: unknown): AppTabs => {
      const code = (e as { code?: string }).code;
      if (code === "locked")
        return { note: `${NOT_BROUGHT} macOS didn't allow ${APP} to ask Dia for them. Allow it in System Settings › Privacy & Security › Automation, then import again.` };
      return { note: `${NOT_BROUGHT} ${code === "notRunning" ? "Dia didn't open." : "Dia didn't answer."}` };
    },
  );
}

export function importAppTabs(dest: string, tabs: AppTabs, profiles: BrowserProfile[], profileId: string, wanted: Set<ImportKind>): number {
  if (!("result" in tabs)) return 0;
  const dia = diaProfilesFor(tabs.result, profiles).get(profileId);
  if (!dia) return 0;
  return importDiaProfile(dest, dia, { pinned: wanted.has("pinnedTabs"), open: wanted.has("tabs") }, tabs.result.favicons);
}
