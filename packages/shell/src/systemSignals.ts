import type { EventSubscription } from "expo-modules-core";

export type SystemSignal = { type: "sleep" } | { type: "wake" } | { type: "idle"; threshold: number; idle: boolean };

export type SystemSignalsNative = {
  watchIdle(thresholds: number[]): void;
  holdsIncomingLinks(): boolean;
  setHoldIncomingLinks(hold: boolean): void;
  devPost(name: "willSleep" | "didWake"): Promise<boolean>;
  addListener(name: "onSystemSignal", listener: (e: SystemSignal) => void): EventSubscription;
};
