import { deleteProfileData } from "../../platform/profiles";
import { useBrowser } from "../browser/store";
import { confirm } from "../../platform/dialogs";

export { clearBrowsingData, type BrowsingDataType } from "../../platform/profiles";

const CLOSE_DELAY_MS = 1500;

const failed = new Set<string>();
let running = false;

const inUse = (engine: string) => Object.values(useBrowser.getState().profiles).some((p) => p.engineId === engine);

async function drain() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const engine = useBrowser.getState().orphanedProfileData.find((e) => !failed.has(e));
      if (engine === undefined) return;
      await new Promise((resolve) => setTimeout(resolve, CLOSE_DELAY_MS));
      if (inUse(engine)) {
        useBrowser.getState().spaceDataDeleted(engine);
        continue;
      }
      const remaining = await deleteProfileData(engine).catch((error: unknown) => [String(error)]);
      if (remaining.length) {
        failed.add(engine);
        console.warn(`Couldn't delete profile data (${engine || "original profile"}): ${remaining.join(", ")}`);
        void confirm({ title: "Some Profile Data Could Not Be Removed", message: "The profile was removed from Settings, but some local browsing files remain. Ardia will retry removing them when it next opens. Encrypted sync copies are kept separately.", confirmTitle: "OK" }).catch((error: unknown) => console.warn("Could not show the profile cleanup error", error));
      } else {
        useBrowser.getState().spaceDataDeleted(engine);
      }
    }
  } finally {
    running = false;
  }
}

export function startProfileDataCleanup() {
  failed.clear();
  void drain();
  return useBrowser.subscribe((s, prev) => {
    if (s.orphanedProfileData !== prev.orphanedProfileData) void drain();
  });
}
