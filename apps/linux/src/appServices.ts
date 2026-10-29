import type { CommandEvent } from "../../browser/src/platform/commands";
import { onLinuxCommand } from "./shims/expo-modules-core";
import { copyText } from "../../browser/src/platform/clipboard";
import { isDefaultBrowser, setAsDefaultBrowser, systemInfo } from "../../browser/src/platform/app";
import { beginTracing, endTracing, isTracing, openTaskManager } from "../../browser/src/platform/performance";
import { confirm } from "../../browser/src/platform/dialogs";
import { revealFile } from "../../browser/src/platform/files";
import { readDocument, removeDocument, saveDocument } from "../../browser/src/platform/documents";
import { afterFirstWindow } from "../../browser/src/lib/afterFirstWindow";
import { diagnostics, sendFeedback } from "../../browser/src/state/commands/appCommands";
import { finishOnboarding, maybeStartOnboarding, onboardingCompletedAt, startOnboarding, useOnboarding } from "../../browser/src/state/onboarding/onboarding";
import { offerDefaultBrowserAgain } from "../../browser/src/state/onboarding/defaultBrowserOffer";
import { openVideoTour, startToolTour, videoTourUrl } from "../../browser/src/state/onboarding/tour";
import { trackAppVersion } from "../../browser/src/state/releaseNotes/releaseNotes";
import { openReleaseNotesAfterUpdate, openReleaseNotesPage } from "../../browser/src/state/releaseNotes/releaseNotesPage";
import { showToast } from "../../browser/src/state/app/toasts";
import { useBrowser } from "../../browser/src/state/browser/store";
import type { LinuxCapabilities } from "./hostCapabilities.ts";
import { ardiaHost, hostSupports, invokeHost, type ArdiaHost } from "./host.ts";
import { QUIT_COMMAND, createHostQuit, type QuitOutcome } from "./quit.ts";
import { BROWSER_COMMAND_CHANNEL, BROWSER_WINDOW_COMMANDS, regularFocusOrder, routeToBrowserWindow, serveBrowserCommands, type RouteChannel } from "./browserCommandRoute.ts";

export const APP_LAUNCH_LOCK = "ardia.linux.app-launch";
export const APP_LAUNCH_MARK = "ardia.linux.app-launch";
export const ONBOARDING_DOCUMENT = "onboarding.json";
export const FRESH_PROFILE_DOCUMENT = "linux-fresh-profile.json";
export const LAUNCH_STEPS = ["version", "onboarding", "releaseNotes", "defaultBrowserOffer"] as const;

export type LaunchStep = (typeof LAUNCH_STEPS)[number] | "versionUpdated";
export type LaunchLocks = { request(name: string, callback: () => Promise<void>): Promise<unknown> };
export type LaunchMarks = { setItem(key: string, value: string): void };
export type LaunchRecord = { done(): Promise<ReadonlySet<string>>; complete(step: LaunchStep): Promise<unknown> };
export type LaunchClaim = "ran" | "alreadyDone" | "failed" | "unavailable";
export type DocumentPresence = "present" | "absent" | "unknown";
export type OnboardingEvidence = { onboarding: DocumentPresence; freshProfile: DocumentPresence; savedSession: boolean };
export type StoredDocumentReader = (name: string) => Promise<string | null>;

const report = (error: unknown) => console.warn("[ardia linux] app services", error);

export function hostLaunchRecord(host: ArdiaHost): LaunchRecord | undefined {
  if (!hostSupports("ArdiaShell.launchSteps", host) || !hostSupports("ArdiaShell.completeLaunchStep", host)) return undefined;
  return {
    done: async () => {
      const steps = await invokeHost<unknown>("ArdiaShell.launchSteps", { args: [] }, host);
      return new Set(Array.isArray(steps) ? steps.filter((step): step is string => typeof step === "string") : []);
    },
    complete: (step) => invokeHost("ArdiaShell.completeLaunchStep", { args: [step] }, host),
  };
}

export const hostStoredDocument = (host: ArdiaHost): StoredDocumentReader => async (name) => {
  const contents = await invokeHost<unknown>("ArdiaShell.readDocument", { args: [name] }, host);
  if (contents === null || typeof contents === "string") return contents;
  throw new Error(`Unexpected stored document reply for ${name}`);
};

export function claimAppLaunch(options: { locks?: LaunchLocks; record?: LaunchRecord; marks?: LaunchMarks; run: (done: ReadonlySet<string>) => Promise<void> }): Promise<LaunchClaim> {
  const { locks, record, marks, run } = options;
  return new Promise((resolve) => {
    if (!locks || !record) return resolve("unavailable");
    locks.request(APP_LAUNCH_LOCK, async () => {
      const done = await record.done();
      if (LAUNCH_STEPS.every((step) => done.has(step))) return resolve("alreadyDone");
      try {
        marks?.setItem(APP_LAUNCH_MARK, "ran");
        await run(done);
        resolve("ran");
      } catch (error) {
        report(error);
        resolve("failed");
      }
    }).catch((error: unknown) => {
      report(error);
      resolve("unavailable");
    });
  });
}

export function onboardingAction(evidence: OnboardingEvidence): "shared" | "complete" | "skip" {
  if (evidence.onboarding === "unknown" || evidence.freshProfile === "unknown") return "skip";
  if (evidence.onboarding === "present") return "shared";
  if (evidence.freshProfile === "present" || !evidence.savedSession) return "shared";
  return "complete";
}

async function storedPresence(name: string, readStored: StoredDocumentReader): Promise<DocumentPresence> {
  try {
    return (await readStored(name)) === null ? "absent" : "present";
  } catch (error) {
    report(error);
    return "unknown";
  }
}

async function onboardingPresence(readStored: StoredDocumentReader): Promise<DocumentPresence> {
  const stored = await storedPresence(ONBOARDING_DOCUMENT, readStored);
  const snapshot = readDocument(ONBOARDING_DOCUMENT) !== null;
  if (stored === "present" && !snapshot) return "unknown";
  return stored === "absent" && snapshot ? "present" : stored;
}

export async function recordFreshProfile(save: (name: string, contents: string) => Promise<void> = saveDocument) {
  try {
    await save(FRESH_PROFILE_DOCUMENT, JSON.stringify({ version: 1, createdAt: Date.now() }));
  } catch (error) {
    report(error);
  }
}

export async function runLaunchServices(options: {
  windowId: string;
  savedSession: boolean;
  capabilities: LinuxCapabilities;
  done: ReadonlySet<string>;
  complete: (step: LaunchStep) => Promise<unknown>;
  readStored: StoredDocumentReader;
}) {
  const { windowId, savedSession, capabilities, done, complete, readStored } = options;
  const updatedNow = trackAppVersion();
  const updated = done.has("versionUpdated") || (!done.has("version") && updatedNow);
  if (!done.has("version")) {
    if (updated && !done.has("versionUpdated")) await complete("versionUpdated");
    await complete("version");
  }
  if (!done.has("onboarding")) {
    const evidence = { onboarding: await onboardingPresence(readStored), freshProfile: await storedPresence(FRESH_PROFILE_DOCUMENT, readStored), savedSession };
    const action = onboardingAction(evidence);
    if (evidence.onboarding === "present" && evidence.freshProfile === "present") removeDocument(FRESH_PROFILE_DOCUMENT);
    if (action === "complete") finishOnboarding();
    if (action === "shared") {
      maybeStartOnboarding();
      const onboarding = useOnboarding.getState().windowId;
      if (onboarding && onboarding !== windowId) useOnboarding.setState({ windowId });
    }
    await complete("onboarding");
  }
  if (!done.has("releaseNotes")) {
    if (updated) openReleaseNotesAfterUpdate();
    await complete("releaseNotes");
  }
  if (!done.has("defaultBrowserOffer")) {
    if (capabilities.defaultBrowser) {
      afterFirstWindow(() => {
        void offerDefaultBrowserAgain({
          read: readDocument,
          save: saveDocument,
          testInstance: systemInfo().isolatedInstance !== false,
          onboarding: !onboardingCompletedAt() || useOnboarding.getState().windowId !== null,
          isDefault: isDefaultBrowser,
          setDefault: setAsDefaultBrowser,
        }).catch(report);
      });
    }
    await complete("defaultBrowserOffer");
  }
}

const unavailable = (windowId: string, feature: string) => showToast(windowId, "Not available on Linux yet", `${feature} isn't available in this Linux build.`);

async function recordPerformanceIssue() {
  if (await isTracing()) return;
  const start = await confirm({
    title: "Record a performance issue?",
    message: "Ardia records what the engine does while you reproduce the problem. The recording is saved to your Downloads folder.",
    confirmTitle: "Start Recording",
  });
  if (!start.confirmed || !(await beginTracing())) return;
  const stop = await confirm({ title: "Recording…", message: "Reproduce the problem now, then click Stop.", confirmTitle: "Stop", cancelTitle: "Discard" });
  const path = await endTracing(stop.confirmed);
  if (path) void revealFile(path);
}

let quitLinux: (() => Promise<QuitOutcome>) | undefined;
const linuxQuit = () => quitLinux ??= ardiaHost
  ? createHostQuit(ardiaHost, confirm)
  : () => Promise.reject(Object.assign(new Error("Quitting needs the Linux host"), { code: "ERR_UNAVAILABLE" }));

function quitApp(windowId: string) {
  void linuxQuit()().catch((error: unknown) => {
    if ((error as { code?: string } | null)?.code === "ERR_UNAVAILABLE") return unavailable(windowId, "Quit");
    report(error);
    showToast(windowId, "Ardia couldn't quit", "Try again, or close each window.");
  });
}

export function runAppCommand(windowId: string, command: CommandEvent["command"], capabilities: LinuxCapabilities): boolean {
  if ((command as string) === QUIT_COMMAND) {
    quitApp(windowId);
    return true;
  }
  switch (command) {
    case "sendFeedback":
      void sendFeedback(windowId).then(
        () => !capabilities.externalLinks && !systemInfo().feedbackURL && showToast(windowId, "Feedback report copied", "Paste it into an email to the Ardia team."),
        () => unavailable(windowId, "Send Feedback"),
      );
      return true;
    case "copyDiagnostics":
      void diagnostics().then(copyText, report);
      return true;
    case "recordPerformanceIssue":
      if (capabilities.performanceRecording) void recordPerformanceIssue().catch(() => unavailable(windowId, "Performance recording"));
      else unavailable(windowId, "Performance recording");
      return true;
    case "showOnboarding":
      startOnboarding(windowId);
      return true;
    case "toolTour":
      void startToolTour(windowId).catch(report);
      return true;
    case "videoTour":
      if (videoTourUrl()) openVideoTour(windowId);
      else unavailable(windowId, "The video tour");
      return true;
    case "releaseNotes":
      if (systemInfo().releaseNotesURL) openReleaseNotesPage(windowId);
      else unavailable(windowId, "Release notes");
      return true;
    case "taskManager":
      if (capabilities.taskManager) void openTaskManager().catch(() => unavailable(windowId, "Task Manager"));
      else unavailable(windowId, "Task Manager");
      return true;
  }
  return false;
}

export const UTILITY_APP_COMMANDS: ReadonlySet<string> = new Set(["copyDiagnostics", "recordPerformanceIssue", "taskManager", QUIT_COMMAND]);

const routeChannel = () => typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(BROWSER_COMMAND_CHANNEL) as unknown as RouteChannel;

export async function routeUtilityCommand(windowId: string, command: CommandEvent["command"], channel: RouteChannel | null) {
  const ran = channel ? await routeToBrowserWindow({ channel, command }) : null;
  if (!ran) showToast(windowId, "No browser window to show this in", "Open a browser window, then try again.");
  return ran;
}

export function startAppCommands(windowId: string, capabilities: LinuxCapabilities, subscribe: (listener: (event: CommandEvent) => void) => { remove(): void } = (listener) => onLinuxCommand((event) => listener(event as CommandEvent)), only?: ReadonlySet<string>, channel: () => RouteChannel | null = routeChannel) {
  let route: RouteChannel | null | undefined;
  return subscribe((event) => {
    if (event.windowId !== windowId) return;
    if (!only || only.has(event.command)) runAppCommand(windowId, event.command, capabilities);
    else if (BROWSER_WINDOW_COMMANDS.has(event.command)) void routeUtilityCommand(windowId, event.command, route === undefined ? (route = channel()) : route).catch(report);
  });
}

export function serveUtilityCommands(options: {
  windowId: string;
  capabilities: LinuxCapabilities;
  privateWindow: boolean;
  channel?: () => RouteChannel | null;
  focus?: (id: string) => Promise<unknown>;
}) {
  if (options.privateWindow) return null;
  const channel = (options.channel ?? routeChannel)();
  if (!channel) return null;
  return serveBrowserCommands({
    windowId: options.windowId,
    channel,
    focus: options.focus ?? ((id) => invokeHost("ArdiaShell.focusWindow", { args: [id] })),
    order: () => regularFocusOrder(useBrowser.getState()),
    run: (id, command) => runAppCommand(id, command, options.capabilities),
  });
}

export function startLinuxAppServices(options: {
  host: ArdiaHost;
  windowId: string;
  savedSession: boolean;
  capabilities: LinuxCapabilities;
  locks?: LaunchLocks;
  marks?: LaunchMarks;
}) {
  const { host, windowId, savedSession, capabilities, locks, marks } = options;
  const commands = startAppCommands(windowId, capabilities);
  serveUtilityCommands({ windowId, capabilities, privateWindow: !!host.bootstrap.privateWindow });
  const record = hostLaunchRecord(host);
  const launch = claimAppLaunch({
    locks,
    record,
    marks,
    run: (done) => runLaunchServices({ windowId, savedSession, capabilities, done, complete: record!.complete, readStored: hostStoredDocument(host) }),
  });
  return { commands, launch };
}
