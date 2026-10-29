import { call, inputIdleSeconds, on, type BatterySaverMode, type EngineTask, type MemorySaverMode, type MemorySaverRequest, type SystemState } from "@ardia/ardiacore";

export { inputIdleSeconds };
export type { EngineTask, MemorySaverMode, SystemState };

export const listTasks = () => call("engine.tasks");
export const systemState = () => call("engine.systemState");
export const onSystemState = (listener: (state: SystemState) => void) => on("engine.systemState", listener);
export const setBatterySaver = (mode: BatterySaverMode) => call("engine.batterySaver", { mode });
export const setMemorySaver = (request: MemorySaverRequest) => call("engine.memorySaver", request);
export const isKeepActiveSiteValid = (site: string) => call("engine.validateKeepActiveSite", { site }).then((reply) => reply.valid);
export const trimEngineMemory = () => call("engine.trimMemory");
export const beginTracing = () => call("engine.beginTracing");
export const endTracing = (keep: boolean) => call("engine.endTracing", { keep });
export const isTracing = () => call("engine.isTracing");
export const openTaskManager = () => call("engine.openTaskManager");
