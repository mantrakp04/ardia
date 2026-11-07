import type { PageState } from "../../state/tabs/pageState";

export function newTabToastPrompt(page: PageState | undefined, popover: unknown, engineOffer: unknown = null): boolean {
  return !!(page?.crashed || page?.unresponsive || page?.permission || page?.passwordPrompt || page?.autofillPrompt || page?.externalApp || popover || engineOffer);
}
