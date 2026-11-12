import { ok, type Desktop, type Engine, type Handler, type PowerReading } from "./calling";
import { desktopOf } from "./exports";

export const POWER_POLL_MS = 20_000;
const MEMORY_WARNING_LOAD = 85;
const MEMORY_CRITICAL_LOAD = 95;

export type SystemStateShape = {
  onBattery: boolean;
  batteryLevel: number | null;
  lowPowerMode: boolean;
  memoryPressure: "normal" | "warning" | "critical";
  physicalMemory: number;
};

const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

export function systemStateOf(reading: PowerReading | null): SystemStateShape {
  const percent = number(reading?.batteryPercent);
  const load = number(reading?.memoryLoad) ?? 0;
  return {
    onBattery: reading?.onBattery === true,
    batteryLevel: percent === null ? null : Math.min(1, Math.max(0, percent / 100)),
    lowPowerMode: reading?.batterySaver === true,
    memoryPressure: load >= MEMORY_CRITICAL_LOAD ? "critical" : load >= MEMORY_WARNING_LOAD ? "warning" : "normal",
    physicalMemory: number(reading?.physicalMemory) ?? 0,
  };
}

const watched = new WeakSet<Desktop>();

function watchPower(engine: Engine, desktop: Desktop, first: SystemStateShape) {
  if (watched.has(desktop)) return;
  watched.add(desktop);
  let last = JSON.stringify(first);
  desktop.every(POWER_POLL_MS, () => {
    const state = systemStateOf(desktop.power());
    const text = JSON.stringify(state);
    if (text === last) return;
    last = text;
    engine.emit("engine.systemState", state);
  });
}

export const systemState: Handler = async (_args, engine) => {
  const desktop = desktopOf(engine);
  const state = systemStateOf(desktop.power());
  watchPower(engine, desktop, state);
  return ok(state);
};
