import { hasOwnOrSharedPage } from "../tabs/pageSession";
import type { BrowserState } from "../browser/store";

export const hasLiveSpaceContent = (s: BrowserState, spaceId: string): boolean =>
  Object.values(s.tabs).some((tab) => tab.spaceId === spaceId && tab.pin?.as !== "tile" && hasOwnOrSharedPage(tab));
