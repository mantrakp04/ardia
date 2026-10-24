import { type ContentBlockerProvider } from "@ardia/ardiacore";
import { selectContentBlocker } from "./contentBlockerSelection";

export async function applyOnboardingBlocker(provider: ContentBlockerProvider, isCurrent: () => boolean, windowId?: string) {
  return selectContentBlocker(provider, { isCurrent, windowId });
}
