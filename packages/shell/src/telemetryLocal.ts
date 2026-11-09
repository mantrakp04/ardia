export type TelemetryLocalStats = { bytes: number; lines: number; files: number; droppedLines: number; pruneMs: number; writeMs: number[] };

export type TelemetryLocalExport = { path: string; bytes: number; lines: number };

export type TelemetryLocalNative = {
  append(day: string, text: string): void;
  appendNow(day: string, text: string): void;
  configure(maxBytes: number, keepDays: number): void;
  prune(now: number): Promise<TelemetryLocalStats>;
  clear(): Promise<void>;
  exportForReport(since: number): Promise<TelemetryLocalExport | null>;
  exportToDownloads(now: number): Promise<TelemetryLocalExport | null>;
};
