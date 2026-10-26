import { useBrowser } from "../browser/store";
import type { BrowserState } from "../browser/store";

export const useHistory = <T>(select: (history: BrowserState["history"]) => T): T => useBrowser((s) => select(s.history));

export const useWindowHistory = (windowId: string | null) => useBrowser((s) => s.history[s.windows[windowId ?? ""]?.profileId ?? ""]);
