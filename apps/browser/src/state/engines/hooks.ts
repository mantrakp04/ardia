import { useBrowser } from "../browser/store";
import { builtInEngine, engineMark, recommendedEngineFor, ruleFor, tabEngine } from "./engines";

export const useEngineMark = (tabId: string) => useBrowser((s) => engineMark(s, tabId));

export const usePageEngine = (tabId: string) => useBrowser((s) => tabEngine(s, tabId));

export const useEngineRule = (url: string | undefined | null) => useBrowser((s) => ruleFor(s, url));

export const useRecommendedEngine = (url: string | undefined | null) => useBrowser((s) => recommendedEngineFor(s, url));

export const useStreamingSite = (url: string | undefined | null) => useBrowser((s) => !!builtInEngine(s, url));
