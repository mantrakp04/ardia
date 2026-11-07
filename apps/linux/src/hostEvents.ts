export type NativeListener = (event: unknown) => void;

export function createNativeEvents() {
  const listeners = new Map<string, Set<{ listener: NativeListener }>>();
  const key = (module: string, event: string) => `${module}:${event}`;
  return {
    emit(module: string, event: string, payload: unknown) {
      for (const { listener } of [...(listeners.get(key(module, event)) ?? [])]) {
        try { listener(payload); } catch (error) { console.error(`[ardia host] ${module}.${event} listener failed`, error); }
      }
    },
    add(module: string, event: string, listener: NativeListener) {
      const id = key(module, event);
      const set = listeners.get(id) ?? new Set<{ listener: NativeListener }>();
      listeners.set(id, set);
      const subscription = { listener };
      set.add(subscription);
      return { remove() {
        set.delete(subscription);
        if (!set.size && listeners.get(id) === set) listeners.delete(id);
      } };
    },
    removeAll(module: string, event?: string) {
      for (const id of listeners.keys()) {
        if (event ? id === key(module, event) : id.startsWith(`${module}:`)) listeners.delete(id);
      }
    },
  };
}
