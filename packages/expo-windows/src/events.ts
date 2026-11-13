import type { EventSubscription } from "expo-modules-core";
import { DeviceEventEmitter } from "react-native";

export type { EventSubscription };

export const nativeEventName = (module: string, event: string) => `${module}:${event}`;

const listeners = new Map<string, number>();
type Held = { payload: unknown; delivered?: () => void };
const held = new Map<string, Held[]>();

export function emitNativeEvent(module: string, event: string, payload: unknown) {
  DeviceEventEmitter.emit(nativeEventName(module, event), payload);
}

export function emitWhenListened(module: string, event: string, payload: unknown, delivered?: () => void) {
  const name = nativeEventName(module, event);
  if ((listeners.get(name) ?? 0) > 0) {
    DeviceEventEmitter.emit(name, payload);
    return void delivered?.();
  }
  held.set(name, [...(held.get(name) ?? []), { payload, delivered }]);
}

function releaseHeld(name: string) {
  const waiting = held.get(name);
  if (!waiting || !listeners.get(name)) return;
  held.delete(name);
  for (const { payload, delivered } of waiting) {
    DeviceEventEmitter.emit(name, payload);
    delivered?.();
  }
}

export function addNativeListener(module: string, event: string, listener: (payload: unknown) => void): EventSubscription {
  const name = nativeEventName(module, event);
  const subscription = DeviceEventEmitter.addListener(name, listener);
  listeners.set(name, (listeners.get(name) ?? 0) + 1);
  if (held.has(name)) setTimeout(() => releaseHeld(name), 0);
  let removed = false;
  return {
    remove: () => {
      if (removed) return;
      removed = true;
      subscription.remove();
      listeners.set(name, Math.max(0, (listeners.get(name) ?? 1) - 1));
    },
  };
}
