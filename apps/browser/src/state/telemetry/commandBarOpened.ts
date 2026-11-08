import { activeTabId } from "../browser/model";
import type { BrowserState } from "../browser/store";
import { rowsCovered } from "../sidebar/hover";

export function commandBarOpenedProperties(s: BrowserState, windowId: string) {
  return { drawn: activeTabId(s, windowId) !== undefined, rows_covered: rowsCovered(windowId) };
}
