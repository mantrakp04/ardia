import { moduleDefaults } from "../defaults";
import { discardOffered, parkPage, releasePage } from "./pages";

type Call = (name: string, profile: string, args: string) => Promise<string>;

const ANSWERED: Record<string, Record<string, unknown>> = {
  ArdiaTabs: { lastTabPolicy: { ok: true } },
};

const withAnswers = (module: string): Call => {
  const fallback = moduleDefaults[module]?.call as Call | undefined;
  return async (name, profile, args) => {
    const answer = ANSWERED[module]?.[name];
    if (answer !== undefined) return JSON.stringify(answer);
    return fallback ? fallback(name, profile, args) : "null";
  };
};

export const engineModules: Record<string, Record<string, unknown>> = {
  ArdiaTabs: {
    call: withAnswers("ArdiaTabs"),
    prepareTransfer: (tabId: string) => parkPage(tabId),
    releaseTransfer: (tabId: string) => releasePage(tabId),
    claimLaunchTab: () => {},
    revealTab: () => {},
    dropTabReveals: () => {},
    revealOffered: () => {},
    discardOffered: (adoptId: string) => discardOffered(adoptId),
  },
};
