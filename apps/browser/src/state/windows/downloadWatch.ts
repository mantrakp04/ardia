import { useBrowser, type BrowserState } from "../browser/store";
import { downloadVisibleIn } from "./ui";

const openWhenDone = new Set<string>();

export const watchOpenWhenDone = (open: (path: string) => void) =>
  useBrowser.subscribe((s, prev) => {
    if (s.downloads === prev.downloads || !openWhenDone.size) return;
    for (const d of s.downloads) {
      if (d.state !== "downloading" && openWhenDone.delete(d.id) && d.state === "finished") open(d.path);
    }
  });

export const opensWhenDone = (id: string) => openWhenDone.has(id);

export function toggleOpenWhenDone(id: string) {
  if (openWhenDone.has(id)) openWhenDone.delete(id);
  else openWhenDone.add(id);
}

export const onDownloadsChanged = (listener: () => void) =>
  useBrowser.subscribe((s, prev) => {
    if (s.downloads !== prev.downloads) listener();
  });

export function watchNewDownloads(windowId: string, onFresh: (download: BrowserState["downloads"][number]) => void) {
  const seen = new Set(useBrowser.getState().downloads.map((d) => d.id));
  return useBrowser.subscribe((s, prev) => {
    if (s.downloads === prev.downloads) return;
    const fresh = s.downloads.find((d) => !seen.has(d.id));
    s.downloads.forEach((d) => seen.add(d.id));
    if (!fresh || s.ui.focusedWindowId !== windowId || !downloadVisibleIn(fresh, s.windows[windowId])) return;
    onFresh(fresh);
  });
}
