import { useBrowser } from "../browser/store";
import { movingTabIds, resolveDrop, type DragSource, type DropSpot } from "../drag/drops";
import { descendantIds } from "../groups/groups";
import { cleanUpCandidates } from "../pins/organize";
import { sharedTabsIn, sharesTabs } from "../tabs/tabShare";
import { addressBarInSidebar } from "../windows/layout";

const store = () => useBrowser.getState();

export const isAddressBarInSidebar = (windowId: string) => addressBarInSidebar(store(), windowId);

export const movingTabsFrom = (lead: string) => movingTabIds(store(), lead);

export const descendantGroupIds = (groupId: string) => descendantIds(store().groups, groupId);

export const resolveDropNow = (source: DragSource, spot: DropSpot | null) => resolveDrop(store(), source, spot);

export const cleanUpCandidateCount = (windowId: string) => cleanUpCandidates(store(), windowId).length;

export function sharedTabsForPanel(windowId: string) {
  const s = store();
  return sharesTabs(s) ? sharedTabsIn(s.tabs, windowId) : null;
}
