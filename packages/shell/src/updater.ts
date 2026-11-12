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
      switchCheck?: SwitchCheck | null;
    };

export type SwitchCheck = {
  phase: "waiting" | "checking" | "found" | "upToDate" | "newerThanLatest" | "failed";
  channel: UpdateChannel;
  version?: string;
};

export type UpdateChannel = "stable" | "nightly";

export type UpdaterNative = {
  updaterState(): Promise<UpdaterState>;
  checkForUpdates(): Promise<void>;
  setAutomaticUpdateChecks(on: boolean): Promise<void>;
  setAutomaticUpdateDownloads(on: boolean): Promise<void>;
  setUpdateChannel(channel: UpdateChannel): Promise<void>;
};
