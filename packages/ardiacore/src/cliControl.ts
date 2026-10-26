import { call, on } from "./engine/call";

export type CliControlStatus = {
  state: "off" | "starting" | "on" | "external";
  port?: number;
  connections?: number;
  generation?: number;
  file?: string;
  reason?: string;
};

export const setCliControl = (on: boolean) => call("engine.cliControl", { on });

export const setCliActiveTab = (tabId: string | null) => call("engine.cliControl", { activeTab: tabId });

export const cliControlStatus = () => call("engine.cliControl");

export const onCliControlChanged = (listener: (status: CliControlStatus) => void) =>
  on("engine.cliControl", (payload) => listener(payload as unknown as CliControlStatus));
