import { navigationTo } from "../browser/model";
import type { AdoptId, Navigation, Tab, TabPage } from "../browser/types";

type Paged = Pick<Tab, "page">;
type PagedAt = Pick<Tab, "page" | "url">;

export const IDLE: TabPage = { kind: "idle" };
export const ASLEEP: TabPage = { kind: "asleep" };

export const loadedPage = (nav: Navigation): TabPage => ({ kind: "loaded", nav });
export const adoptedPage = (adopt: AdoptId, nav: Navigation | null = null): TabPage => ({ kind: "adopted", adopt, nav });

export const hasPage = (t: Paged) => t.page.kind === "loaded" || t.page.kind === "adopted";

export const hasLoadedPage = (t: PagedAt) => !!t.url && hasPage(t);

export const navigationOf = (t: Paged | undefined): Navigation | null => (t?.page.kind === "loaded" || t?.page.kind === "adopted" ? t.page.nav : null);

export const adoptOf = (t: Paged | undefined): AdoptId | undefined => (t?.page.kind === "adopted" ? t.page.adopt : undefined);

export const hasNavigatedPage = (t: PagedAt) => !!t.url && !!navigationOf(t);

export const holderOfPage = (t: Paged | undefined): string | undefined => (t?.page.kind === "frozen" ? t.page.holderId : undefined);

export const hasOwnOrSharedPage = (t: Paged) => hasPage(t) || t.page.kind === "frozen";

export const isAsleep = (t: Paged | undefined) => t?.page.kind === "asleep";

export const isLazy = (t: PagedAt) => !!t.url && !hasPage(t);

export const needsPage = (t: PagedAt) => isLazy(t) && t.page.kind !== "frozen";

export const restoredLazily = (t: PagedAt) => !!t.url && t.page.kind === "idle";

export const wakeOf = (t: Paged | undefined): AdoptId | undefined => (t && "wake" in t.page ? t.page.wake : undefined);

export const withWake = (page: TabPage, wake: AdoptId | undefined): TabPage => {
  if (page.kind !== "idle" && page.kind !== "asleep" && page.kind !== "frozen") return page;
  const { wake: _, ...rest } = page;
  return wake ? { ...rest, wake } : rest;
};

export const wokenPage = (t: PagedAt): TabPage => {
  const wake = wakeOf(t);
  return wake ? adoptedPage(wake) : loadedPage(navigationTo(t.url));
};

export const frozenOn = (t: Paged, holderId: string): TabPage => withWake({ kind: "frozen", holderId }, wakeOf(t));

export const asleepFrom = (t: Paged): TabPage => withWake(ASLEEP, wakeOf(t));

export const withNavigationAt = (t: PagedAt): TabPage => {
  const nav = navigationOf(t);
  return nav && (t.page.kind === "loaded" || t.page.kind === "adopted") ? { ...t.page, nav: { ...nav, url: t.url || nav.url } } : t.page;
};

export const renavigated = (t: Paged, nav: Navigation): TabPage => (t.page.kind === "adopted" ? adoptedPage(t.page.adopt, nav) : loadedPage(nav));
