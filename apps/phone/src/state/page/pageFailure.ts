import type { PageState } from "../../platform/pages.ts";

export type PageFailure = NonNullable<PageState["failure"]>;

export type FailureIcon = "crashed" | "offline" | "network";

export function failureIcon(failure: PageFailure): FailureIcon {
  if (failure.kind === "crashed") return "crashed";
  return failure.reason === "offline" ? "offline" : "network";
}

export const retriesWhenOnline = (failure: PageFailure) => failure.kind === "network" && failure.reason === "offline";

export type FailureHold = { shown: PageFailure | null; sawLoad: boolean };

export const NO_FAILURE: FailureHold = { shown: null, sawLoad: false };

export function holdFailure(hold: FailureHold, failure: PageFailure | null, isLoading: boolean): FailureHold {
  if (failure) return hold.shown === failure && !hold.sawLoad ? hold : { shown: failure, sawLoad: false };
  if (!hold.shown) return hold;
  if (isLoading) return hold.sawLoad ? hold : { shown: hold.shown, sawLoad: true };
  return hold.sawLoad ? NO_FAILURE : hold;
}
