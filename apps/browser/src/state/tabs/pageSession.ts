import type { Tab } from "../browser/types";

export const hasPage = (t: Tab) => !!t.navigation || !!t.adoptId;

export const hasLoadedPage = (t: Tab) => !!t.url && hasPage(t);

export const hasNavigatedPage = (t: Tab) => !!t.url && !!t.navigation;

export const hasOwnOrSharedPage = (t: Tab) => hasPage(t) || !!t.pageIn;

export const isLazy = (t: Tab) => !!t.url && !hasPage(t);

export const needsPage = (t: Tab) => isLazy(t) && !t.pageIn;

export const restoredLazily = (t: Tab) => needsPage(t) && !t.unloaded;
