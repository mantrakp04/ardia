import { extensionActionStates } from "../../platform/extensions";
import { useBrowser } from "../browser/store";
import { activeTabId } from "../browser/model";
import { extensionProfile, readyTabOf, useExtensions, windowExtensions } from "./store";

let running: Promise<void> | null = null;
let again = false;
let pendingAll = false;
const pendingProfiles = new Set<string>();

export function refreshActionStates(profiles?: Iterable<string>): Promise<void> {
  if (profiles) for (const profile of profiles) pendingProfiles.add(profile);
  else pendingAll = true;
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        const only = pendingAll ? null : new Set(pendingProfiles);
        pendingAll = false;
        pendingProfiles.clear();
        await pass(only);
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function pass(only: Set<string> | null) {
  const s = useBrowser.getState();
  const { popup } = useExtensions.getState();
  await Promise.all(
    s.windowOrder.filter((windowId) => !only || only.has(extensionProfile(s, windowId))).map(async (windowId) => {
      const ids = windowExtensions(s, windowId)
        .filter((x) => x.hasAction !== false && (x.pinned || popup?.extensionId === x.id))
        .map((x) => x.id);
      const tabId = readyTabOf(activeTabId(s, windowId));
      if (!ids.length || !tabId) return;
      const states = await extensionActionStates(tabId, ids).catch(() => null);
      const previous = useExtensions.getState().actions[tabId];
      if (!states || (previous && JSON.stringify(previous) === JSON.stringify(states))) return;
      useExtensions.setState((e) => ({ actions: { ...e.actions, [tabId]: states } }));
    }),
  );
}
