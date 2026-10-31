import type { BrowserState } from "../../browser/src/state/browser/store";
import type { Tab } from "../../browser/src/state/browser/types";
import type { ArdiaHost } from "./host";
import { invokeHost, reportHostError } from "./host.ts";

type TabState = Pick<BrowserState, "tabs">;
type TabStore = { getState(): TabState; subscribe(listener: (s: TabState, prev: TabState) => void): () => void };
const holdsPage = (tab: Tab) => tab.page.kind !== "frozen" && tab.page.kind !== "asleep";

export function startHostTabLifecycle(host: ArdiaHost, store: TabStore) {
  const pending = new Set<string>();
  const closed = new Set<string>();
  let queued = false;
  let stopped = false;
  const drain = () => {
    queued = false;
    if (stopped) return;
    const { tabs } = store.getState();
    for (const key of pending) {
      const tab = tabs[key];
      if (closed.has(key) || tab && tab.page.kind !== "asleep") continue;
      closed.add(key);
      void invokeHost("tab.close", { key }, host).catch((error) => { if (!stopped) reportHostError(error); });
    }
    pending.clear();
  };
  const stopStore = store.subscribe((s, prev) => {
    if (stopped || s.tabs === prev.tabs) return;
    for (const key of closed) if (s.tabs[key] && holdsPage(s.tabs[key]!)) closed.delete(key);
    for (const [key, before] of Object.entries(prev.tabs)) {
      const after = s.tabs[key];
      if (holdsPage(before) && (!after || after.page.kind === "asleep")) pending.add(key);
    }
    if (pending.size && !queued) {
      queued = true;
      queueMicrotask(drain);
    }
  });
  const stopClosing = host.onBeforeClose?.(() => {
    stopped = true;
    pending.clear();
  });
  return () => {
    stopped = true;
    pending.clear();
    stopStore();
    stopClosing?.();
  };
}
