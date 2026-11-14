import { call, on, type CliControlStatus } from "@ardia/ardiacore";
import { nativeModule, type CliInstallResult } from "@ardia/shell";

export type { CliControlStatus, CliInstallResult };

const Cli = nativeModule("ArdiaCli");

export const installedCliVersion = () => Cli.installedVersion();
export const installCli = () => Cli.install();
export const onCliInstallLine = (listener: (line: string) => void) => Cli.addListener("onInstallLine", (e) => listener(e.line));

export const setCliControl = (on: boolean) => call("engine.setCliControl", { on });
export const setCliActiveTab = (tabId: string | null) => call("engine.setCliActiveTab", { tabId });
export const cliControlStatus = () => call("engine.cliControlStatus");
export const cliTabTargets = (tabIds: string[]) => call("engine.cliTabTargets", { tabIds });
export const cliOwnsTab = (tabId: string) => call("engine.cliOwnsTab", { tabId });
export const cliMoveOffscreen = (tabId: string) => call("engine.cliMoveOffscreen", { tabId });
export const cliCloseOffscreenTabs = () => call("engine.cliCloseOffscreenTabs");
export const onCliControlChanged = (listener: (status: CliControlStatus) => void) => on("engine.cliControl", listener);
