import type { CommandEvent, ConfirmOptions, PromptOptions } from "@ardia-real/shell";
import { emitCommand as emitWebCommand, confirm as webConfirm, prompt as webPrompt } from "./shellBase";
import { provideNativeModuleProvider } from "./expo-modules-core";
import { linuxHostDialogs } from "../hostDialogs";
import { ardiaHost, hostModuleMethod, reportHostError } from "../host";
import { flushLinuxSession, isLinuxUtility, linuxWindowDeparture } from "../session";
import { createWindowCloseBarrier, type WindowCloseRequest } from "../utilityClose";
import { quiesceLinuxSession, resumeLinuxSession } from "../sessionClose";
import { quiesceLinuxDocuments, resumeLinuxDocuments, flushLinuxDocuments } from "../documentFlush";
import { linuxMenuShortcuts } from "../shortcuts";
import { useBrowser } from "../../../browser/src/state/browser/store";
import { setManagedWindowClose } from "../../../browser/src/platform/windowClose";
import { createWindowCloseCoordinator, type DecideClose, type DialogSuspension, type DrainReply } from "../windowCloseCoordinator";

export * from "./shellBase";
export { menuShown, showMenu, watchMenus } from "../menus";
import { recordShortcut, cancelShortcutRecording } from "../shortcutsRuntime";
export { recordShortcut, cancelShortcutRecording };

export const confirm = (options: ConfirmOptions) => ardiaHost ? linuxHostDialogs().confirm(options) : webConfirm(options);
export const prompt = (options: PromptOptions) => ardiaHost ? linuxHostDialogs().prompt(options) : webPrompt(options);
provideNativeModuleProvider((name, method) => name === "ArdiaShell" && method === "confirm" ? confirm : name === "ArdiaShell" && method === "prompt" ? prompt : undefined);

export const emitCommand = (event: CommandEvent) => emitWebCommand(ardiaHost
  ? { ...event, windowId: ardiaHost!.bootstrap.windowId }
  : event);

export const menuShortcuts = async () => linuxMenuShortcuts(useBrowser.getState().settings.shortcuts);

const closeToken = (request: WindowCloseRequest) => JSON.stringify(request);
const ownWindowId = ardiaHost?.bootstrap.windowId ?? "";
const closeBarrier = createWindowCloseBarrier({
  quiesce: (request) => { quiesceLinuxSession(closeToken(request)); quiesceLinuxDocuments(closeToken(request)); },
  drain: async () => { await flushLinuxSession(); return flushLinuxDocuments(); },
  acknowledge: (request, watermark) => {
    const departure = closeCoordinator.departs(request) ? linuxWindowDeparture(request.windowId) : undefined;
    return hostModuleMethod("ArdiaShell", "acknowledgeWindowClose")({ ...request, watermark, ...(departure ? { departure } : {}) }) as Promise<void>;
  },
  reject: (request) => hostModuleMethod("ArdiaShell", "rejectWindowClose")(request) as Promise<void>,
  resume: (request) => {
    closeCoordinator.producersResumed(request);
    resumeLinuxSession(closeToken(request));
    resumeLinuxDocuments(closeToken(request));
  },
});
let provideDecider: (decide: DecideClose) => void = () => {};
const decider = new Promise<DecideClose>((resolve) => { provideDecider = resolve; });
export const setWindowCloseDecider = (decide: DecideClose) => provideDecider(decide);
const decideClose: DecideClose = (windowId, reason, ask) => decider.then((decide) => decide(windowId, reason, ask));
const closeCoordinator = createWindowCloseCoordinator({
  windowId: ownWindowId,
  utility: isLinuxUtility(ownWindowId),
  decide: decideClose,
  suppress: (reason) => useBrowser.getState().updateSettings(reason === "lastTab" ? { warnBeforeClosingLastTab: false } : { warnBeforeClosingWindow: false }),
  flush: flushLinuxSession,
  request: (id) => hostModuleMethod("ArdiaShell", "requestWindowClose")(id) as Promise<WindowCloseRequest>,
  beginDrain: (request) => hostModuleMethod("ArdiaShell", "beginWindowCloseDrain")(request) as Promise<DrainReply>,
  reject: (request) => hostModuleMethod("ArdiaShell", "rejectWindowClose")(request) as Promise<void>,
  barrier: closeBarrier,
  cancelled: closeBarrier.cancelled,
  ...(ardiaHost ? {
    ask: (options: ConfirmOptions, signal: AbortSignal) => linuxHostDialogs().abortableConfirm(options, signal),
    suspendDialogs: () => linuxHostDialogs().suspend(),
    resumeDialogs: (suspension: DialogSuspension) => linuxHostDialogs().resume(suspension),
  } : {}),
  report: reportHostError,
});
const reportClose = (error: unknown) => {
  if ((error as { code?: string } | null)?.code !== "ERR_WINDOW_CLOSE_CANCELLED") reportHostError(error);
};
ardiaHost?.onEvent((module, event, payload) => {
  if (module !== "ArdiaShell" || event !== "shell") return;
  const envelope = payload as { name: string; data: WindowCloseRequest; quitting?: boolean };
  if (envelope?.name === "shell.closeRequested") void closeCoordinator.accept(envelope.data, { quitting: envelope.quitting === true }).catch(reportClose);
  if (envelope?.name === "shell.closeCancelled" && envelope.data?.windowId === ownWindowId)
    closeCoordinator.cancelled(envelope.data);
});
if (ardiaHost && !isLinuxUtility(ownWindowId)) setManagedWindowClose((windowId, reason) => {
  if (windowId !== ownWindowId) return false;
  void closeCoordinator.close(reason).catch(reportClose);
  return true;
});
export const closeWindow = (id: string): Promise<void> => closeCoordinator.closeWindow(id);
const managedShell: Record<string, unknown> = { closeWindow, menuShortcuts, recordShortcut, cancelRecording: cancelShortcutRecording };
provideNativeModuleProvider((name, method) => name === "ArdiaShell" && Object.hasOwn(managedShell, method) ? managedShell[method] : undefined);
