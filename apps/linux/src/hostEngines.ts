import * as shared from "../../browser/src/state/engines/engines.ts";
import { linuxCapabilities } from "./hostCapabilities.ts";

export * from "../../browser/src/state/engines/engines.ts";

const webkit = linuxCapabilities().webkit;

export const canSwitchEngine: typeof shared.canSwitchEngine = (url) => webkit && shared.canSwitchEngine(url);
export const defaultEngine: typeof shared.defaultEngine = (s) => (webkit ? shared.defaultEngine(s) : "chromium");
export const ruleFor: typeof shared.ruleFor = (s, url) => (webkit ? shared.ruleFor(s, url) : undefined);
export const builtInEngine: typeof shared.builtInEngine = (s, url) => (webkit ? shared.builtInEngine(s, url) : undefined);
export const chosenEngine: typeof shared.chosenEngine = (s, url) => (webkit ? shared.chosenEngine(s, url) : shared.siteOf(url) ? "chromium" : undefined);
export const recommendedEngineFor: typeof shared.recommendedEngineFor = (s, url) => (webkit ? shared.recommendedEngineFor(s, url) : "chromium");
export const engineForUrl: typeof shared.engineForUrl = (s, url) => (webkit ? shared.engineForUrl(s, url) : "chromium");
export const tabEngine: typeof shared.tabEngine = (s, tabId) => (webkit ? shared.tabEngine(s, tabId) : "chromium");
export const typedNavigationEngine: typeof shared.typedNavigationEngine = (s, tab, url) => (webkit ? shared.typedNavigationEngine(s, tab, url) : "chromium");
export const engineMark: typeof shared.engineMark = (s, tabId) => (webkit ? shared.engineMark(s, tabId) : null);
