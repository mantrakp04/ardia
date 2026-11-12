import { useMemo } from "react";
import { useBrowser } from "../browser/store";
import { useDownloadProgress } from "./progress";

export function useDownload(id: string) {
  const download = useBrowser((s) => s.downloads.find((d) => d.id === id));
  const progress = useDownloadProgress((s) => s[id]);
  return useMemo(() => download && progress && download.state === "downloading" ? { ...download, ...progress } : download, [download, progress]);
}
