import { hostOf } from "@ardia/core";
import type { BrowserState } from "../browser/store";
import type { HistoryEntry } from "../browser/types";
import { historyOf } from "../history/history";


const historyHostCache = new WeakMap<HistoryEntry[], string[]>();

export function historyHosts(history: HistoryEntry[]): string[] {
  let hosts = historyHostCache.get(history);
  if (!hosts) {
    const set = new Set<string>();
    for (const h of history) set.add(hostOf(h.url));
    set.delete("");
    historyHostCache.set(history, (hosts = [...set]));
  }
  return hosts;
}

let last: { tabs: BrowserState["tabs"]; history: HistoryEntry[]; profileId: string; hosts: string[] } | null = null;

export function knownHosts(s: BrowserState, profileId: string): string[] {
  const history = historyOf(s, profileId);
  if (last && last.tabs === s.tabs && last.history === history && last.profileId === profileId) return last.hosts;
  const hosts: string[] = [];
  for (const t of Object.values(s.tabs)) if (t.profileId === profileId && t.url) hosts.push(hostOf(t.url));
  const all = hosts.concat(historyHosts(history));
  last = { tabs: s.tabs, history, profileId, hosts: all };
  return all;
}
