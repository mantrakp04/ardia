import type { ConfirmOptions } from "@ardia-real/shell";
import { useBrowser } from "../../browser/src/state/browser/store";
import { hostSupports, invokeHost, type ArdiaHost } from "./host.ts";

export const QUIT_COMMAND = "quit";
export const QUIT_LOCK = "ardia.linux.quit";

export type QuitOutcome = "quitting" | "cancelled" | "busy";
export type QuitAnswer = { confirmed: boolean; suppressed: boolean };
export type QuitAsk = (options: ConfirmOptions) => Promise<QuitAnswer>;
export type QuitLocks = {
  request(name: string, options: { ifAvailable: true }, callback: (lock: unknown) => Promise<QuitOutcome>): Promise<QuitOutcome>;
};
export type LinuxQuitHooks = {
  appName: () => string;
  warnBeforeQuitting: () => boolean;
  stopWarning: () => void;
  ask: QuitAsk;
  downloadsInProgress: () => Promise<number>;
  quit: () => Promise<unknown>;
  locks?: QuitLocks;
};

export const quitWarning = (app: string): ConfirmOptions => ({
  title: `Are you sure you want to quit ${app}?`,
  message: "Your windows and tabs will be restored the next time you open it.",
  confirmTitle: "Quit",
  cancelTitle: "Cancel",
  suppression: "Don't ask again",
});

export const downloadsWarning = (app: string, count: number): ConfirmOptions => ({
  title: `Are you sure you want to quit ${app}?`,
  message: count === 1
    ? "You have 1 download in progress. If you quit now, this download will be cancelled."
    : `You have ${count} downloads in progress. If you quit now, these downloads will be cancelled.`,
  confirmTitle: "Quit",
  cancelTitle: "Cancel",
});

const quitError = (code: string, message: string) => Object.assign(new Error(message), { code });

export function createLinuxQuit(hooks: LinuxQuitHooks) {
  let running: Promise<QuitOutcome> | null = null;
  const attempt = async (): Promise<QuitOutcome> => {
    if (hooks.warnBeforeQuitting()) {
      const answer = await hooks.ask(quitWarning(hooks.appName()));
      if (answer.suppressed) hooks.stopWarning();
      if (!answer.confirmed) return "cancelled";
    }
    const downloads = await hooks.downloadsInProgress();
    if (downloads > 0 && !(await hooks.ask(downloadsWarning(hooks.appName(), downloads))).confirmed) return "cancelled";
    await hooks.quit();
    return "quitting";
  };
  const claimed = (): Promise<QuitOutcome> => hooks.locks
    ? hooks.locks.request(QUIT_LOCK, { ifAvailable: true }, (lock) => lock ? attempt() : Promise.resolve("busy"))
    : attempt();
  return (): Promise<QuitOutcome> => running ??= claimed().finally(() => { running = null; });
}

const browserLocks = (): QuitLocks | undefined => typeof navigator === "undefined" ? undefined : (navigator as { locks?: QuitLocks }).locks;

const QUIT_ROUTES = ["ArdiaShell.downloadsInProgress", "ArdiaShell.quit"];

export function createHostQuit(host: ArdiaHost, ask: QuitAsk, locks: QuitLocks | undefined = browserLocks()) {
  if (!QUIT_ROUTES.every((method) => hostSupports(method, host)))
    return () => Promise.reject(quitError("ERR_UNAVAILABLE", "Quitting isn't available in this Linux build"));
  return createLinuxQuit({
    appName: () => "Ardia",
    warnBeforeQuitting: () => useBrowser.getState().settings.warnBeforeQuitting,
    stopWarning: () => useBrowser.getState().updateSettings({ warnBeforeQuitting: false }),
    ask,
    downloadsInProgress: async () => {
      const count = await invokeHost<unknown>("ArdiaShell.downloadsInProgress", { args: [] }, host);
      if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) throw quitError("ERR_QUIT", "The download count is unreadable");
      return count;
    },
    quit: () => invokeHost("ArdiaShell.quit", { args: [] }, host),
    locks,
  });
}
