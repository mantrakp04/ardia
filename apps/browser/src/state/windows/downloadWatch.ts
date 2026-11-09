import { openFile } from "../../platform/files";
import { useBrowser, type BrowserState } from "../browser/store";
import { downloadVisibleIn } from "../downloads/downloadsSlice";
import { focusedWindowOf } from "./ui";

const openWhenDone = new Set<string>();

let openingWhenDone = false;

export function startOpenWhenDone() {
  if (openingWhenDone) return;
  openingWhenDone = true;
  useBrowser.subscribe((s, prev) => {
    if (s.downloads === prev.downloads || !openWhenDone.size) return;
    for (const d of s.downloads) {
      if (d.state !== "downloading" && openWhenDone.delete(d.id) && d.state === "finished") void openFile(d.path);
    }
  });
}

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
    if (!fresh || focusedWindowOf(s) !== windowId || !downloadVisibleIn(s, fresh, s.windows[windowId])) return;
    onFresh(fresh);
  });
}
