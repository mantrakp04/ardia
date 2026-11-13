import type { DecideClose } from "./windowCloseCoordinator";
import { useBrowser } from "../../browser/src/state/browser/store";
import { decideLastTabClose, decideWindowClose } from "../../browser/src/state/windows/windowClose";

export const decideLinuxWindowClose: DecideClose = async (windowId, reason, ask) => {
  if (!useBrowser.getState().windows[windowId]) return { decision: "allow", suppressWarning: false };
  return reason === "lastTab" ? decideLastTabClose(windowId, ask) : decideWindowClose(windowId, ask);
};
