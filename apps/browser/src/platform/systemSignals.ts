import type { EventSubscription } from "expo-modules-core";
import { nativeModule, type MovedDownload, type SystemSignal } from "@ardia/shell";

export type { MovedDownload };

let bound: ReturnType<typeof nativeModule<"ArdiaSystemSignals">> | null = null;
const Signals = () => (bound ??= nativeModule("ArdiaSystemSignals"));

const sleepListeners = new Set<() => void>();
const wakeListeners = new Set<() => void>();
const idleListeners = new Map<number, Set<(idle: boolean) => void>>();
const idleNow = new Map<number, boolean>();
let subscription: EventSubscription | null = null;

function dispatch(signal: SystemSignal) {
  if (signal.type === "sleep") return [...sleepListeners].forEach((listener) => listener());
  if (signal.type === "wake") return [...wakeListeners].forEach((listener) => listener());
  const listeners = idleListeners.get(signal.threshold);
  if (!listeners || idleNow.get(signal.threshold) === signal.idle) return;
  idleNow.set(signal.threshold, signal.idle);
  [...listeners].forEach((listener) => listener(signal.idle));
}

function listen() {
  subscription ??= Signals().addListener("onSystemSignal", dispatch);
}

function releaseIfUnused() {
  if (sleepListeners.size || wakeListeners.size || idleListeners.size) return;
  subscription?.remove();
  subscription = null;
}

function subscribeTo(listeners: Set<() => void>, listener: () => void) {
  const own = () => listener();
  listeners.add(own);
  listen();
  return () => {
    if (!listeners.delete(own)) return;
    releaseIfUnused();
  };
}

export const onSystemSleep = (listener: () => void): (() => void) => subscribeTo(sleepListeners, listener);

export const onSystemWake = (listener: () => void): (() => void) => subscribeTo(wakeListeners, listener);

export function onUserIdle(thresholdSeconds: number, listener: (idle: boolean) => void): () => void {
  if (!Number.isFinite(thresholdSeconds) || thresholdSeconds <= 0) throw new RangeError(`idle threshold must be a positive number of seconds, got ${thresholdSeconds}`);
  const own = (idle: boolean) => listener(idle);
  let listeners = idleListeners.get(thresholdSeconds);
  const added = !listeners;
  if (!listeners) idleListeners.set(thresholdSeconds, (listeners = new Set()));
  listeners.add(own);
  listen();
  if (added) Signals().watchIdle([...idleListeners.keys()]);
  else if (idleNow.get(thresholdSeconds)) queueMicrotask(() => listeners.has(own) && own(true));
  return () => {
    if (!listeners.delete(own)) return;
    if (listeners.size) return;
    idleListeners.delete(thresholdSeconds);
    idleNow.delete(thresholdSeconds);
    Signals().watchIdle([...idleListeners.keys()]);
    releaseIfUnused();
  };
}

export const setHoldIncomingLinks = (hold: boolean, hooksStamp: string | null): void => Signals().setHoldIncomingLinks(hold, hooksStamp);

export const setApprovedDownloadFolders = (folders: string[]): void => Signals().setApprovedDownloadFolders(folders);

export const moveCompletedDownload = (path: string, folder: string): Promise<MovedDownload> => Signals().moveCompletedDownload(path, folder);

export const devPostSystemSignal = (name: "willSleep" | "didWake"): Promise<boolean> => Signals().devPost(name);
