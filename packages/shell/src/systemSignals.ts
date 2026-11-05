import type { EventSubscription } from "expo-modules-core";

export type SystemSignal = { type: "sleep" } | { type: "wake" } | { type: "idle"; threshold: number; idle: boolean };

export type MovedDownload = { ok: true; path: string } | { ok: false; reason: string; stagedPath?: string; strayPath?: string };

export type SystemSignalsNative = {
  watchIdle(thresholds: number[]): void;
  holdsIncomingLinks(): boolean;
  setHoldIncomingLinks(hold: boolean, hooksStamp: string | null): void;
  devPost(name: "willSleep" | "didWake"): Promise<boolean>;
  setApprovedDownloadFolders(folders: string[]): void;
  moveCompletedDownload(path: string, folder: string): Promise<MovedDownload>;
  addListener(name: "onSystemSignal", listener: (e: SystemSignal) => void): EventSubscription;
};
