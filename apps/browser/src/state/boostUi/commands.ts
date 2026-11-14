import { editBoostForTab, newBoostForTab, turnOffBoostsForSite } from "./actions";

export function runBoostCommand(command: string, windowId: string, tabId: string | undefined): boolean {
  switch (command) {
    case "newBoost":
      if (tabId) newBoostForTab(windowId, tabId);
      return true;
    case "editBoost":
      if (tabId) editBoostForTab(windowId, tabId);
      return true;
    case "turnOffBoosts":
      if (tabId) turnOffBoostsForSite(tabId);
      return true;
  }
  return false;
}
