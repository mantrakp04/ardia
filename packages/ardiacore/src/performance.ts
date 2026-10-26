import { call } from "./engine/call";
import { nativeModule } from "./nativeModules";

export type BatterySaverMode = "on" | "off" | "default";

export type BatterySaverState = { state: number; active: boolean };

export const openTaskManager = () => call("engine.openTaskManager");

export const setBatterySaver = (mode: BatterySaverMode) => call("engine.batterySaver", { mode });

export const trimEngineMemory = () => call("engine.trimMemory");

export const inputIdleSeconds = () => nativeModule("ArdiaEngine").inputIdleSeconds();
