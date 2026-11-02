import type { EventSubscription } from "expo-modules-core";

export type ReadyUpdate = { build: string; version: string; displayVersion: string };

export type UpdaterState =
  | { available: false }
  | {
      available: true;
      configured: boolean;
      automaticChecks: boolean;
      automaticDownloads: boolean;
      canCheck: boolean;
      sessionInProgress: boolean;
      feedURL: string | null;
      lastCheck: number | null;
      version: string;
      displayVersion?: string;
      channel?: UpdateChannel;
      buildChannel?: UpdateChannel;
      ready?: ReadyUpdate | null;
    };

export type UpdateChannel = "stable" | "nightly";

export type UpdaterNative = {
  updaterState(): Promise<UpdaterState>;
  checkForUpdates(): Promise<void>;
  setAutomaticUpdateChecks(on: boolean): Promise<void>;
  setAutomaticUpdateDownloads(on: boolean): Promise<void>;
  setUpdateChannel(channel: UpdateChannel): Promise<void>;
  restartToUpdate(): Promise<void>;
  addListener(name: "onReadyUpdate", listener: (e: { ready: ReadyUpdate | null }) => void): EventSubscription;
};
