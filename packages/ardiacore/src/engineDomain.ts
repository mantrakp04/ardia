import { nativeModule } from "./nativeModules";

export type EngineInfo = {
  pid: number;
  dataDirectory: string;
  engine: string;
  chromiumVersion: string;
  liveBrowsers: number;
  popupWindows: number;
  chromeWindows: number;
  focus?: string;
};

export type EngineComponent = {
  id: string;
  name: string;
  version: string;
  state:
    | "new" | "checking" | "canUpdate" | "downloading" | "decompressing" | "patching" | "updating" | "updated"
    | "upToDate" | "updateError" | "run" | "unknown";
};

export type EngineTask = {
  id: number;
  type:
    | "browser" | "gpu" | "zygote" | "utility" | "renderer" | "extension" | "guest" | "plugin" | "sandboxHelper"
    | "dedicatedWorker" | "sharedWorker" | "serviceWorker" | "unknown";
  title: string;
  killable: boolean;
  cpu: number;
  processors: number;
  memory: number;
  gpuMemory: number;
  tabIds: (string | null)[];
  pid?: number;
};

export type SystemState = {
  onBattery: boolean;
  batteryLevel: number | null;
  lowPowerMode: boolean;
  memoryPressure: "normal" | "warning" | "critical";
  physicalMemory: number;
};

export const WIDEVINE_COMPONENT_ID = "oimompecagnajdejgnnjijobebaeigek";

export type BatterySaverMode = "on" | "off" | "default";

export type BatterySaverState = { state: number; active: boolean };

export type MemorySaverMode = "moderate" | "balanced" | "maximum";

export type MemorySaverRequest = { state?: "on" | "off"; aggressiveness?: MemorySaverMode; sites?: string[] };

export type MemorySaverState = { state: "on" | "off"; aggressiveness: MemorySaverMode; active: boolean; sites: string[]; invalid: string[] };

export const inputIdleSeconds = () => nativeModule("ArdiaEngine").inputIdleSeconds();

type CliServer = { connections: number; generation: number; file: string; reason?: string };

export type HoverLostEpisode = {
  reason: "halfActive" | "staleMenu" | "notKeyOrMain" | "coveredByView" | "responderLost";
  trigger: "move" | "click";
  keyWindow: string;
  mainWindow: string;
  preventKey: boolean;
  canKey: boolean;
  windowMain: boolean;
  halfActive: boolean;
  appActive: boolean;
  runningActive: boolean;
  frontmost: boolean;
  menuActive: boolean;
  overPage: boolean;
  cover: "none" | "reactNative" | "chromium" | "other";
  coverClear: boolean;
  healed: boolean;
  healWorked: boolean | null;
  endedBy: "hover" | "heal" | "appInactive" | "windowClosed";
  seconds: number;
  episode: number;
};

export type CliTabTarget = { targetId: string | null; pageGeneration: number };

export type CliDragsEnded = { ownerGone: number; debuggerUnowned: number; nativeRefused: number; sourceGone?: number };

export type CliControlStatus = { dragsEnded?: CliDragsEnded } & (
  | { state: "external" }
  | ({ state: "off" | "starting" } & CliServer)
  | ({ state: "on"; port: number } & CliServer)
);
