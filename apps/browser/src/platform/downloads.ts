import { call, on, type Download, type DownloadSettings } from "@ardia/ardiacore";

export type { Download, DownloadSettings };

export const onDownload = (listener: (d: Download) => void) => on("downloads.changed", listener);
export const cancelDownload = (id: string) => call("downloads.cancel", { id });
export const pauseDownload = (id: string) => call("downloads.pause", { id });
export const resumeDownload = (id: string) => call("downloads.resume", { id });
export const keepDownload = (id: string) => call("downloads.keep", { id });
export const getDownloadSettings = (profile = "") => call("downloads.settings", { profile });
export const setDownloadSettings = (patch: Partial<Pick<DownloadSettings, "folder" | "askWhereToSave">>, profile = "") =>
  call("downloads.setSettings", { ...patch, profile });
export const removeDownloadStaging = (path: string) => call("webKit.removeDownloadStaging", { path });
