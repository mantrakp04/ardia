import { useBrowser } from "../browser/store";
import { useShallow } from "zustand/react/shallow";
import { closedGroupsOnBarForProfile } from "./closedGroups";
import { groupLabel } from "../pins/tabGrouping";

export const useGroupLabel = (groupId: string) => useBrowser((s) => (s.groups[groupId] ? groupLabel(s, s.groups[groupId]!) : ""));

export const useClosedGroupsForProfile = (profileId: string) => useBrowser(useShallow((s) => closedGroupsOnBarForProfile(s, profileId)));
