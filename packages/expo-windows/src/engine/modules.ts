import { engineDomainModules } from "./domains";
import { setCover, setPageRadius } from "./covers";
import { discardOffered, parkPage, releasePage } from "./pages";

const pageCovers = {
  set: (windowId: string, id: string, x: number, y: number, width: number, height: number) => setCover(windowId, id, { x, y, width, height }),
  clear: (windowId: string, id: string) => setCover(windowId, id, null),
  setRadius: (radius: number, windowId?: string) => setPageRadius(radius, windowId ?? ""),
};

export const engineModules: Record<string, Record<string, unknown>> = {
  ArdiaPageCovers: pageCovers,
  ...engineDomainModules,
  ArdiaTabs: {
    ...engineDomainModules.ArdiaTabs,
    prepareTransfer: (tabId: string) => parkPage(tabId),
    releaseTransfer: (tabId: string) => releasePage(tabId),
    claimLaunchTab: () => {},
    revealTab: () => {},
    dropTabReveals: () => {},
    revealOffered: () => {},
    discardOffered: (adoptId: string) => discardOffered(adoptId),
  },
};
