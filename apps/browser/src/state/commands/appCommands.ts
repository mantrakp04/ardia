import { beginTracing, endTracing, isTracing, openTaskManager } from "../../platform/performance";
import { confirm } from "../../platform/dialogs";
import { copyText } from "../../platform/clipboard";
import { engineInfo, openExternalURL, systemInfo, updaterState } from "../../platform/app";
import { revealFile } from "../../platform/files";
import { startOnboarding } from "../onboarding/onboarding";
import { openVideoTour, startToolTour } from "../onboarding/tour";
import { useBrowser } from "../browser/store";
import { openUrls } from "../browser/actions";
import { openReleaseNotesPage } from "../releaseNotes/releaseNotesPage";
import type { AppCommand } from "./commandCatalog";

export const APP_COMMAND_HANDLERS: Readonly<Record<AppCommand, (windowId: string | null) => void>> = {
  sendFeedback: (windowId) => void sendFeedback(windowId),
  copyDiagnostics: () => void diagnostics().then(copyText),
  recordPerformanceIssue: () => void recordPerformanceIssue(),
  discardPerformanceRecording: () => void finishPerformanceRecording(false),
  showOnboarding: (windowId) => startOnboarding(windowId),
  toolTour: (windowId) => void startToolTour(windowId),
  videoTour: (windowId) => openVideoTour(windowId),
  releaseNotes: (windowId) => openReleaseNotesPage(windowId),
  taskManager: () => void openTaskManager().catch(() => {}),
};

export async function sendFeedback(windowId?: string | null) {
  const app = systemInfo();
  const report = await diagnostics();
  const body = `What happened?\n\n\nWhat did you expect?\n\n\n---\n${report}`;
  const page = app.feedbackURL && /^https?:/i.test(app.feedbackURL) ? app.feedbackURL : null;
  if (page) return openUrls([page.replace("%s", encodeURIComponent(body))], windowId);
  const to = app.feedbackEmail && !/[\s?&]/.test(app.feedbackEmail) ? app.feedbackEmail : "";
  const draft = `mailto:${to}?subject=${encodeURIComponent(`${app.appName} Feedback`)}&body=${encodeURIComponent(body)}`;
  if (!(await openExternalURL(draft))) copyText(body);
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
  ].join("\n");
}

let finishingPerformanceRecording: Promise<void> | null = null;

async function recordPerformanceIssue() {
  if (finishingPerformanceRecording) return;
  if (await isTracing()) return finishPerformanceRecording(true);
  const start = await confirm({
    title: "Record a performance issue?",
    message: "Ardia records what the engine does while you reproduce the problem. When you're done, choose Help › Stop Performance Recording. The recording is saved to your Downloads folder.",
    confirmTitle: "Start Recording" });
  if (!start.confirmed || !(await beginTracing())) return;
  useBrowser.getState().setPerformanceRecording(true);
}

function finishPerformanceRecording(keep: boolean) {
  finishingPerformanceRecording ??= endTracing(keep)
    .then((path) => {
      if (path) void revealFile(path);
    })
    .finally(() => {
      finishingPerformanceRecording = null;
      useBrowser.getState().setPerformanceRecording(false);
    });
  return finishingPerformanceRecording;
}
