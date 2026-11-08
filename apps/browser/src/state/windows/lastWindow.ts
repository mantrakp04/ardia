import { useBrowser } from "../browser/store";
import { capture } from "../telemetry/client";
import { ago, bucket } from "../telemetry/journeys";
import { lastWindowToRestore } from "./reopenClosed";

export type LastWindowSource = "dock" | "launch";

const tabCount = (n: number) => bucket(n, [[1, "1"], [5, "2-5"], [20, "6-20"], [50, "21-50"]], "50+");

export function openLastWindowOrNew(source: LastWindowSource): string {
  const s = useBrowser.getState();
  const entry = lastWindowToRestore(s);
  if (!entry) return s.createWindow();
  s.restoreClosed(entry.id);
  const props = { source, tabs: tabCount(entry.tabs.length), pinned_shown: !!entry.activePin, closed_for: ago(Date.now() - entry.closedAt) };
  setTimeout(() => capture("last_window_restored", props), 0);
  return useBrowser.getState().windowOrder.at(-1)!;
}
