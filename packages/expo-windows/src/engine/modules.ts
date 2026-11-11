import { engineDomainModules } from "./domains";
import { discardOffered, parkPage, releasePage } from "./pages";

export const engineModules: Record<string, Record<string, unknown>> = {
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
