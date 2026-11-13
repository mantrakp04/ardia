import { browseLayout } from "./tokens";

export const barCenterFromBottom = (navigationInset: number) =>
  Math.max(browseLayout.barCenterFromBottom, navigationInset + browseLayout.hitTarget / 2);

export const barHeight = (navigationInset: number) =>
  browseLayout.barHeight + (barCenterFromBottom(navigationInset) - browseLayout.barCenterFromBottom);

export const pageBottomInset = (navigationInset: number) => barHeight(navigationInset) - browseLayout.pageOverlap;

export const deckCenterFromBottom = (navigationInset: number) => Math.max(navigationInset, 20) + 6;
