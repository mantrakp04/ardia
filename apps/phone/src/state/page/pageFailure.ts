import type { PageState } from "../../platform/pages.ts";

export type PageFailure = NonNullable<PageState["failure"]>;

export type FailureIcon = "crashed" | "offline" | "network";

export function failureIcon(failure: PageFailure): FailureIcon {
  if (failure.kind === "crashed") return "crashed";
  return failure.reason === "offline" ? "offline" : "network";
}

export const retriesWhenOnline = (failure: PageFailure) => failure.kind === "network" && failure.reason === "offline";
