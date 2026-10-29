import { useBrowser } from "../browser/store";
import { extensionSpace } from "./store";

export const useExtensionSpace = (windowId: string): string => useBrowser((s) => extensionSpace(s, windowId));
