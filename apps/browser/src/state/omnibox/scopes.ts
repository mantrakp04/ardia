import { findScope, offeredSiteSearch, type SearchScope } from "@ardia/core";
import { useBrowser } from "../browser/store";
import { searchEngines } from "../settings/settings";
import { knownHosts } from "./knownHosts";

function scopeSources(windowId: string) {
  const s = useBrowser.getState();
  const profileId = s.windows[windowId]?.profileId ?? "";
  return { engines: searchEngines(s.settings), hosts: knownHosts(s, profileId) };
}

export function scopeFor(text: string, windowId: string): SearchScope | null {
  return findScope(text, scopeSources(windowId));
}

export function offeredScope(typed: string, completion: string, windowId: string): SearchScope | null {
  return offeredSiteSearch(typed, completion, scopeSources(windowId));
}

export function keywordScope(text: string, windowId: string): SearchScope | null {
  const bare = text.trim().replace(/^[a-z]+:\/\//i, "").replace(/\/$/, "");
  if (/[/?#:@]/.test(bare)) return null;
  const scope = scopeFor(text, windowId);
  if (!scope) return null;
  if (bare.includes(".")) return scope;
  if (scope.kind !== "engine") return null;
  const engine = searchEngines(useBrowser.getState().settings).find((e) => e.id === scope.engineId);
  return engine && engine.keyword.toLowerCase() === text.toLowerCase() ? scope : null;
}
