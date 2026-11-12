import { useBrowser } from "../browser/store";
import { extensionProfile } from "./store";

export const useExtensionProfile = (windowId: string): string => useBrowser((s) => extensionProfile(s, windowId));
