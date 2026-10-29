export type NativeListener = (event: unknown) => void;

export function createNativeEvents() {
  const listeners = new Map<string, Set<NativeListener>>();
  const key = (module: string, event: string) => `${module}:${event}`;
  return {
    emit(module: string, event: string, payload: unknown) {
      for (const listener of [...(listeners.get(key(module, event)) ?? [])]) listener(payload);
    },
    add(module: string, event: string, listener: NativeListener) {
      const id = key(module, event);
      const set = listeners.get(id) ?? new Set<NativeListener>();
      listeners.set(id, set);
      set.add(listener);
      return { remove() {
        set.delete(listener);
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
