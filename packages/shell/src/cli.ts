import type { EventSubscription } from "expo-modules-core";

export type CliInstallResult = {
  ok: boolean;
  appVersion: string;
  binPath?: string;
  version?: string;
  rcFile?: string;
  error?: string;
  installedVersion?: string | null;
  lines: string[];
};

export type CliNative = {
  installedVersion(): string | null;
  install(): Promise<CliInstallResult>;
  addListener(name: "onInstallLine", listener: (e: { line: string }) => void): EventSubscription;
};
