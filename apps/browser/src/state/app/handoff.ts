import { setWindowActivity } from "../../platform/windows";
import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId } from "../browser/model";

export function startHandoff() {
  const last = new Map<string, string>();
  const sync = (s: BrowserState) => {
    for (const id of s.windowOrder) {
      const w = s.windows[id]!;
      const tabId = activeTabId(s, id);
      const tab = tabId ? s.tabs[tabId] : undefined;
      const url = w.kind !== "private" && tab?.url && /^https?:/i.test(tab.url) ? tab.url : null;
      const title = tab ? tab.customTitle || tab.title : "";
      const key = `${url}\n${title}`;
      if (last.get(id) === key) continue;
      last.set(id, key);
      void setWindowActivity(id, url, title || null);
    }
    for (const id of last.keys()) if (!s.windows[id]) last.delete(id);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs && s.windows === prev.windows) return;
    timer ??= setTimeout(() => {
      timer = undefined;
      sync(useBrowser.getState());
    }, 250);
  });
  setTimeout(() => sync(useBrowser.getState()), 1000);
}
