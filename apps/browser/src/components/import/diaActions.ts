import { emptyCounts, importDiaProfile } from "../../state/import/apply";
import type { ImportApi, ImportCore } from "./importActions";
import { KINDS, type BrowserProfile, type DiaAutomationStatus, type DiaTabsResult, type ImportKind } from "./model";
import type { ImportState } from "./useImportState";

export const DIA_POLL_MS = 1500;
const DIA_LAUNCH_GRACE_MS = 15_000;
const DIA_READ_TRIES = 8;

export function diaActions(s: ImportState, api: ImportApi | null, core: ImportCore) {
  const runDia = async (result: DiaTabsResult, ids: string[], wanted: Set<ImportKind>) => {
    const selected = result.profiles.filter((p) => ids.includes(p.id));
    const order = KINDS.map((k) => k.kind).filter((k) => (k === "tabs" || k === "pinnedTabs") && wanted.has(k));
    s.setStatus(Object.fromEntries(order.map((k) => [k, "active"])));
    s.setPreparing(selected.length);
    s.setStep("progress");
    const total = emptyCounts();
    for (const [i, p] of selected.entries()) {
      const dest = await core.destination(i, p.name);
      total.tabs += importDiaProfile(dest, p, { pinned: wanted.has("pinnedTabs"), open: wanted.has("tabs") }, result.favicons);
    }
    s.setStatus(Object.fromEntries(order.map((k) => [k, "done"])));
    s.setFailures([]);
    s.setCounts(total);
    core.finish();
  };

  const takeDiaResult = (result: DiaTabsResult) => {
    s.setDia(result);
    if (!result.profiles.length) {
      return s.setError(result.windowCount ? "Dia has no open or pinned web pages to import." : "Dia has no open windows. Open one, then try again.");
    }
    const profiles: BrowserProfile[] = result.profiles.map((p, i) => ({
      id: p.id,
      name: p.name,
      path: "",
      isDefault: i === 0,
      available: ["tabs", "pinnedTabs"],
    }));
    s.setSource((src) => (src ? { ...src, profiles } : src));
    const first = [profiles[0]!.id];
    s.setSourceProfiles(first);
    if (profiles.length > 1) s.setStep("profiles");
    else void runDia(result, first, s.kinds);
  };

  const readDia = async () => {
    if (!api) return;
    s.setError(null);
    s.setDiaStatus("reading");
    let result: DiaTabsResult;
    try {
      result = await api.readDiaTabs();
      for (let i = 0; !result.windowCount && Date.now() - s.diaLaunched.current < DIA_LAUNCH_GRACE_MS && i < DIA_READ_TRIES; i++) {
        await new Promise((r) => setTimeout(r, DIA_POLL_MS));
        result = await api.readDiaTabs();
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      s.setDiaStatus(code === "notRunning" ? "notRunning" : code === "locked" ? "denied" : "granted");
      if (code !== "notRunning" && code !== "locked") s.setError(`${(e as Error).message}. Try again.`);
      return;
    }
    s.setDiaStatus("granted");
    takeDiaResult(result);
  };

  const refreshDia = async () => {
    if (!api) return;
    const status = await api.diaAutomationStatus().catch((): DiaAutomationStatus => "denied");
    s.setDiaStatus(status);
    if (status === "granted") await readDia();
  };

  const allowDia = async () => {
    if (!api) return;
    s.setAsking(true);
    const status = await api.requestDiaAutomation().catch((): DiaAutomationStatus => "denied");
    s.setAsking(false);
    s.setDiaStatus(status);
    if (status === "granted") await readDia();
  };

  const openDia = async () => {
    if (!api) return;
    s.diaLaunched.current = Date.now();
    await api.openDia().catch(() => s.setError("Couldn't open Dia. Open it yourself, then click Check Again."));
    void refreshDia();
  };

  return { runDia, takeDiaResult, readDia, refreshDia, allowDia, openDia };
}
