import { nativeModule, type TelemetryLocalExport, type TelemetryLocalStats } from "@ardia/shell";

const Local = nativeModule("ArdiaTelemetryLocal");

export type { TelemetryLocalExport, TelemetryLocalStats };

export const appendLocal = (day: string, text: string) => Local.append(day, text);
export const appendLocalNow = (day: string, text: string) => Local.appendNow(day, text);
export const configureLocal = (maxBytes: number, keepDays: number) => Local.configure(maxBytes, keepDays);
export const pruneLocal = (now: number) => Local.prune(now);
export const clearLocal = () => Local.clear();
export const exportLocalForReport = (since: number) => Local.exportForReport(since);
export const exportLocalToDownloads = (now: number) => Local.exportToDownloads(now);
