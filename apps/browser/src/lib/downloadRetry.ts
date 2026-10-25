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
    downloadAgain: (url) => {
      if (!useBrowser.getState().windows[windowId]) return false;
      openUrl(url, windowId, "background");
      return true;
    },
    current: (id) => useBrowser.getState().downloads.find((x) => x.id === id),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }).then(
    (outcome) => outcome !== "again" && retrying.delete(d.id),
    () => retrying.delete(d.id),
  );
}
