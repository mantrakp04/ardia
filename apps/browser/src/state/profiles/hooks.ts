import { useShallow } from "zustand/react/shallow";
import { useBrowser } from "../browser/store";
import { sortedProfiles } from "./profiles";

export const useProfiles = () => useBrowser(useShallow((s) => sortedProfiles(s.profiles)));
export const useProfile = (id: string) => useBrowser((s) => s.profiles[id]);
export const useProfileSpaces = (id: string) => useBrowser(useShallow((s) => s.spaceOrder.filter((key) => s.spaces[key]?.profileId === id)));
export const useProfilePrivateWindows = (id: string) => useBrowser((s) => Object.values(s.windows).filter((window) => (window.kind === "private") && window.incognitoEngineId === s.profiles[id]?.engineId).length);

export const useProfileRecords = () => useBrowser((s) => s.profiles);
