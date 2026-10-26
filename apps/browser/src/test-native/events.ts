import type { EventSubscription } from "expo-modules-core";

type Listener = (payload: unknown) => void;

export function nativeEvents() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addListener(name: string, listener: (payload: never) => void): EventSubscription {
      const named = listeners.get(name) ?? new Set<Listener>();
      listeners.set(name, named);
      const call = listener as Listener;
      named.add(call);
      return { remove: () => void named.delete(call) };
    },
    emit(name: string, payload: unknown) {
      for (const listener of [...(listeners.get(name) ?? [])]) listener(payload);
    },
    count: (name: string) => listeners.get(name)?.size ?? 0,
  };
}

export const unfaked = (module: string, method: string) => Promise.reject(new Error(`${module}.${method} has no test fake yet`));
