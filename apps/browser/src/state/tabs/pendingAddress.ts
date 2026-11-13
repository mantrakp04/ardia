import type { AdoptKind } from "../browser/types";
import { adoptKind } from "./adoptIds";

type ReportedPage = { url: string; initialDocumentAccessed?: boolean; committedInitial?: boolean };
type ReportingTab = { adoptId: string | undefined; openedByPage: boolean };

const MADE_BY_THE_APP: readonly AdoptKind[] = ["link", "restore"];

export const isBlankAddress = (url: string) => !url || url === "about:blank";

export function reachableByAnotherPage(adoptId: string | undefined) {
  const adopted = adoptKind(adoptId);
  return !!adopted && !MADE_BY_THE_APP.includes(adopted.kind);
}

export function reportedAddress(page: ReportedPage, tab: ReportingTab): { url: string; untouched: boolean } {
  if (page.committedInitial === undefined) return { url: page.url, untouched: page.url === "" && !(tab.openedByPage && tab.adoptId) };
  const written = page.committedInitial && !!page.initialDocumentAccessed && reachableByAnotherPage(tab.adoptId);
  return { url: written ? "about:blank" : page.url, untouched: page.committedInitial && !written };
}

export const reportedTitle = (title: string, url: string) => (title === "about:blank" && !isBlankAddress(url) ? "" : title);

const awaitingFirstPage = new Set<string>();

export const firstPagePending = (shown: { url: string; committedInitial?: boolean; isLoading: boolean }) => !!shown.committedInitial && shown.isLoading && !isBlankAddress(shown.url);

export function noteFirstPagePending(tabId: string, pending: boolean) {
  if (pending) awaitingFirstPage.add(tabId);
  else awaitingFirstPage.delete(tabId);
}

export const awaitsFirstPage = (tabId: string) => awaitingFirstPage.has(tabId);
