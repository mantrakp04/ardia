import { DeviceEventEmitter } from "react-native";

export type EventSubscription = { remove(): void };

export const nativeEventName = (module: string, event: string) => `${module}:${event}`;

export function emitNativeEvent(module: string, event: string, payload: unknown) {
  DeviceEventEmitter.emit(nativeEventName(module, event), payload);
}

export function addNativeListener(module: string, event: string, listener: (payload: unknown) => void): EventSubscription {
  const subscription = DeviceEventEmitter.addListener(nativeEventName(module, event), listener);
  return { remove: () => subscription.remove() };
}
