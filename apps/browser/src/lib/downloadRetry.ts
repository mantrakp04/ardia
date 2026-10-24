import { resumeDownload, type Download } from "@ardia/ardiacore";
import { openUrl } from "../components/bookmarks/actions";
import { useBrowser } from "../store/browser";
import { retryWith } from "./downloadManager";

const retrying = new Set<string>();

export function retryDownload(d: Download, windowId: string) {
  if (retrying.has(d.id)) return;
  retrying.add(d.id);
  void retryWith(d, {
    resume: resumeDownload,
    downloadAgain: (url) => openUrl(url, windowId, "background"),
    current: (id) => useBrowser.getState().downloads.find((x) => x.id === id),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }).finally(() => retrying.delete(d.id));
}
