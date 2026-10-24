import type { PageState } from "./pageState";

export function newTabToastPrompt(page: PageState | undefined, popover: unknown): boolean {
  return !!(page?.permission || page?.passwordPrompt || page?.autofillPrompt || page?.externalApp || popover);
}
