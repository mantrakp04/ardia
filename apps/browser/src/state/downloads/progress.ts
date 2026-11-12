import { create } from "zustand";
import type { Download } from "../../platform/downloads";
import { noteDownloadWork } from "./work";

type Progress = Pick<Download, "received" | "total" | "speed">;

export const useDownloadProgress = create<Record<string, Progress>>()(() => ({}));

export function updateDownloadProgress(d: Download) {
  const before = useDownloadProgress.getState()[d.id];
  if (d.state !== "downloading") {
    if (before) useDownloadProgress.setState(({ [d.id]: _, ...kept }) => kept, true);
    return;
  }
  if (before && before.received === d.received && before.total === d.total && before.speed === d.speed) return;
  useDownloadProgress.setState({ [d.id]: { received: d.received, total: d.total, speed: d.speed } });
  noteDownloadWork("downloadProgressUpdates");
}

export function retainDownloadProgress(downloads: Download[]) {
  const current = useDownloadProgress.getState();
  const active = new Set(downloads.filter((d) => d.state === "downloading").map((d) => d.id));
  if (Object.keys(current).some((id) => !active.has(id))) {
    useDownloadProgress.setState(Object.fromEntries(Object.entries(current).filter(([id]) => active.has(id))), true);
  }
}
