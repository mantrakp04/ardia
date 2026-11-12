import { openTaskManager } from "../../platform/performance";
import { copyText } from "../../platform/clipboard";
import { engineInfo, systemInfo, updaterState } from "../../platform/app";
import { redoOnboarding } from "../onboarding/onboarding";
import { openVideoTour, startToolTour } from "../onboarding/tour";
import { useBrowser } from "../browser/store";
import { focusedWindowOf } from "../windows/ui";
import { openReport } from "../report/actions";
import { openReleaseNotesPage } from "../releaseNotes/releaseNotesPage";
import type { AppCommand } from "./commandCatalog";

export const APP_COMMAND_HANDLERS: Readonly<Record<AppCommand, (windowId: string | null) => void>> = {
  reportProblem: (windowId) => reportProblem(windowId),
  copyDiagnostics: () => void diagnostics().then(copyText),
  showOnboarding: (windowId) => void redoOnboarding(windowId),
  toolTour: (windowId) => void startToolTour(windowId),
  videoTour: (windowId) => openVideoTour(windowId),
  releaseNotes: (windowId) => openReleaseNotesPage(windowId),
  taskManager: () => void openTaskManager().catch(() => {}),
};

export function reportProblem(windowId?: string | null, source: "menu" | "check_in" = "menu") {
  const s = useBrowser.getState();
  const candidates = [windowId, focusedWindowOf(s), ...s.windowOrder];
  openReport(candidates.find((id) => !!id && !!s.windows[id] && s.windows[id]!.kind !== "small") ?? null, source);
}

export async function diagnostics(): Promise<string> {
  const app = systemInfo();
  const [engine, updates] = await Promise.all([engineInfo().catch(() => null), updaterState().catch(() => null)]);
  const s = useBrowser.getState();
  const regular = s.windowOrder.filter((id) => s.windows[id]?.kind !== "private");
  return [
    `${app.appName} ${app.appVersion} (${app.appBuild}) — ${app.configuration}`,
    engine ? `Engine: ArdiaCore, Chromium ${engine.chromiumVersion}` : "Engine: unavailable",
    `macOS ${app.osVersion} (${app.osBuild}), ${app.arch}, ${app.model}, ${Math.round(app.memoryGB)} GB`,
    `Bundle: ${app.bundleId}, locale ${app.locale}`,
    `Windows: ${regular.length} (+${s.windowOrder.length - regular.length} incognito), tabs: ${Object.keys(s.tabs).length}, profiles: ${s.profileOrder.length}`,
    !updates?.available
      ? "Updates: not built in"
      : !updates.configured
        ? "Updates: not set up for this build"
        : `Updates: automatic checks ${updates.automaticChecks ? "on" : "off"}, feed ${updates.feedURL ?? "none"}`,
    ...(engine?.focus ? [`Focus: ${engine.focus.replace(/\n/g, "\n  ")}`] : []),
  ].join("\n");
}
