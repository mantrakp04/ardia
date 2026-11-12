import { useMemo, useSyncExternalStore } from "react";

const values = new Map<string, number>();
const watchers = new Map<string, Set<() => void>>();

export function setPageProgress(tabId: string, progress: number) {
  if ((values.get(tabId) ?? 0) === progress) return;
  if (progress) values.set(tabId, progress);
  else values.delete(tabId);
  const listeners = watchers.get(tabId);
  if (listeners) for (const listener of [...listeners]) listener();
}

export const pageProgressOf = (tabId: string) => values.get(tabId) ?? 0;

export function watchPageProgress(tabId: string, listener: () => void): () => void {
  let listeners = watchers.get(tabId);
  if (!listeners) watchers.set(tabId, (listeners = new Set()));
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && watchers.get(tabId) === listeners) watchers.delete(tabId);
  };
}

export function usePageProgress(tabId: string): number {
  const subscribe = useMemo(() => (listener: () => void) => watchPageProgress(tabId, listener), [tabId]);
  return useSyncExternalStore(subscribe, () => pageProgressOf(tabId));
}
