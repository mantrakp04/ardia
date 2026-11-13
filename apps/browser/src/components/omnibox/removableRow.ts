import type { Suggestion } from "@ardia/core";

export const isRemovable = (s: Suggestion | undefined): s is Extract<Suggestion, { kind: "page" }> => s?.kind === "page" && !!s.visited && !s.tabId;
