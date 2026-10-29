import type { ArdiaHost } from "./host";
import { hostSupports, invokeHost, reportHostError } from "./host.ts";

type Ask = (options: { title: string; message: string; confirmTitle: string }) => Promise<boolean>;

const TITLE = "Couldn't Use That Folder";

export function createFolderPicker(host: ArdiaHost, ask: Ask) {
  return async (current: string | null, prompt: string | null = null): Promise<string | null> => {
    if (!hostSupports("ArdiaShell.pickFolder", host)) {
      await ask({ title: TITLE, message: "Choosing a folder isn't available in this build of Ardia.", confirmTitle: "OK" }).catch(reportHostError);
      return null;
    }
    for (;;) {
      try {
        const picked = await invokeHost<unknown>("ArdiaShell.pickFolder", { args: [current ?? null, prompt ?? null] }, host);
        return typeof picked === "string" ? picked : null;
      } catch (error) {
        reportHostError(error);
        const message = error instanceof Error && error.message ? error.message : "The folder can't be used.";
        const again = await ask({ title: TITLE, message, confirmTitle: "Choose Another Folder…" }).catch((failure) => {
          reportHostError(failure);
          return false;
        });
        if (!again) return null;
      }
    }
  };
}
