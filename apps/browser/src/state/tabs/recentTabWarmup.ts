import type { SystemState } from "../../platform/performance";
import { useBrowser } from "../browser/store";
import { wake } from "../browser/model";
import { isInternalTab } from "../pages/urls";
import { holderOf } from "../pins/pinShare";
import { restoredLazily } from "./pageSession";
import { shownTabIds } from "./tabKeepAlive";

const store = () => useBrowser.getState();

export function reloadRecentTabs(sys: SystemState) {
  const gb = sys.physicalMemory / 2 ** 30;
  const busy = sys.onBattery || sys.lowPowerMode || sys.memoryPressure !== "normal";
  const count = busy ? 0 : gb >= 32 ? 4 : gb >= 16 ? 3 : gb >= 8 ? 1 : 0;
  const s = store();
  const shown = shownTabIds(s);
  const since = Date.now() - 24 * 60 * 60_000;
  const ids = Object.values(s.tabs)
    .filter((t) => restoredLazily(t) && !shown.has(t.id) && !isInternalTab(t) && t.lastActiveAt >= since)
    .filter((t) => s.windows[t.windowId]?.profileId === t.profileId)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .slice(0, count)
    .map((t) => t.id);
  ids.forEach((id, i) =>
    setTimeout(() => {
      const now = store();
      const t = now.tabs[id];
      if (t && restoredLazily(t) && !holderOf(now, id)) now.updateTab(id, wake(t));
    }, 2000 * (i + 1)),
  );
  return ids;
}
