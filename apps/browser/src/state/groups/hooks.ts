import { useBrowser } from "../browser/store";
import { groupLabel } from "../pins/tabGrouping";

export const useGroupLabel = (groupId: string) => useBrowser((s) => (s.groups[groupId] ? groupLabel(s, s.groups[groupId]!) : ""));
