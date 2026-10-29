import type { StateCreator } from "zustand";

export function transactional<T>(heardAlone?: (s: T, prev: T) => boolean, settle?: (s: T, prev: T) => T) {
  let depth = 0;
  let heard: T | null = null;
  let hear = () => {};

  const middleware =
    (creator: StateCreator<T>): StateCreator<T> =>
    (set, get, api) => {
      type Listener = (s: T, prev: T) => void;
      const listeners = new Set<Listener>();
      let settling = false;
      const publish = (prev: T) => {
        const current = api.getState();
        const settled = settle ? settle(current, prev) : current;
        if (settled !== current) {
          settling = true;
          try {
            (set as (state: T, replace: true) => void)(settled, true);
          } finally {
            settling = false;
          }
        }
        listeners.forEach((listener) => listener(api.getState(), prev));
      };
      hear = () => {
        const prev = heard;
        if (prev === null) return;
        heard = null;
        if (api.getState() === prev) return;
        const held = depth;
        depth = 0;
        try {
          publish(prev);
        } finally {
          depth = held;
        }
      };
      api.subscribe((s, prev) => {
        if (settling) return;
        if (!depth) return publish(prev);
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
