import type { ProviderEntry } from "@ardia/core";
import { useMemo } from "react";
import { isIncognitoProfile } from "../browser/model";
import { useBrowser, type BrowserState } from "../browser/store";
import { configProviders, keywordProviders, pendingConfigProviders, type ActiveProvider } from "./configProviders";
import { useProviderApprovalRevision } from "./providerApproval";
import { useRegisteredProviders, type OmniboxProvider } from "./providers";

const NO_ENTRIES: readonly ProviderEntry[] = [];

type Context = { entries: readonly ProviderEntry[]; profileId: string; privateContext: boolean };

function contextOf(s: BrowserState, windowId: string): Context {
  const w = s.windows[windowId];
  const profileId = w?.profileId ?? "";
  return { entries: s.settings.omniboxProviders ?? NO_ENTRIES, profileId, privateContext: w?.kind === "private" || isIncognitoProfile(profileId) };
}

function merged({ entries, profileId, privateContext }: Context, registered: readonly OmniboxProvider[]): ActiveProvider[] {
  const own = configProviders(entries, { partition: `${profileId}|${privateContext ? "private" : "normal"}`, privateContext });
  if (privateContext) return own;
  const keywords = new Set(own.flatMap((p) => (p.keyword ? [p.keyword.toLowerCase()] : [])));
  const ids = new Set(own.map((p) => p.id));
  const programs = registered.filter((p) => !ids.has(p.id) && !(p.keyword && keywords.has(p.keyword.toLowerCase())));
  return [...own, ...programs.map((p): ActiveProvider => ({ ...p, query: p.query.bind(p), sendsInput: true }))];
}

export const activeProviders = (windowId: string): ActiveProvider[] =>
  merged(contextOf(useBrowser.getState(), windowId), useRegisteredProviders.getState().list);

export const providerKeywords = (windowId: string) => keywordProviders(activeProviders(windowId));

export const pendingOmniboxProviders = () => pendingConfigProviders(useBrowser.getState().settings.omniboxProviders ?? NO_ENTRIES);

export function useActiveProviders(windowId: string): ActiveProvider[] {
  const entries = useBrowser((s) => s.settings.omniboxProviders ?? NO_ENTRIES);
  const profileId = useBrowser((s) => s.windows[windowId]?.profileId ?? "");
  const privateWindow = useBrowser((s) => s.windows[windowId]?.kind === "private");
  const registered = useRegisteredProviders((s) => s.list);
  const revision = useProviderApprovalRevision((s) => s.revision);
  return useMemo(
    () => merged({ entries, profileId, privateContext: privateWindow || isIncognitoProfile(profileId) }, registered),
    [entries, profileId, privateWindow, registered, revision],
  );
}
