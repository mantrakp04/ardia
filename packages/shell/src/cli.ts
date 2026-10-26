import type { EventSubscription } from "expo-modules-core";
import { optionalNativeModule } from "./nativeModules";

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

const Cli = optionalNativeModule("ArdiaCli");

export const installedCliVersion = () => Cli?.installedVersion() ?? null;

export const installCli = (): Promise<CliInstallResult> =>
  Cli ? Cli.install() : Promise.resolve({ ok: false, appVersion: "", error: "This build of Ardia can't install the ardia command.", lines: [] });

export const onCliInstallLine = (listener: (line: string) => void) =>
  Cli?.addListener("onInstallLine", (e) => listener(e.line)) ?? { remove() {} };
