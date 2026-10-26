import type { StateCreator } from "zustand";

export function transactional<T>(heardAlone?: (s: T, prev: T) => boolean) {
  let depth = 0;
  let heard: T | null = null;
  let hear = () => {};

  const middleware =
    (creator: StateCreator<T>): StateCreator<T> =>
    (set, get, api) => {
      type Listener = (s: T, prev: T) => void;
      const listeners = new Set<Listener>();
      const notify = (prev: T) => listeners.forEach((listener) => listener(api.getState(), prev));
      hear = () => {
        const prev = heard;
        if (prev === null) return;
        heard = null;
        if (api.getState() === prev) return;
        const held = depth;
        depth = 0;
        try {
          notify(prev);
        } finally {
          depth = held;
        }
      };
      api.subscribe((s, prev) => {
        if (!depth) return notify(prev);
        heard ??= prev;
        if (heardAlone?.(s, prev)) hear();
      });
      api.subscribe = (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      };
      return creator(set, get, api);
    };

  const transaction = (run: () => void) => {
    depth++;
    try {
      run();
    } finally {
      if (--depth === 0) hear();
    }
  };
  return { middleware, transaction };
}
