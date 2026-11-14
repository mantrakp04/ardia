import { useEffect, useRef } from "react";

export const SETTLE_MS = 120;

export type Size = { width: number; height: number };

export const sameSize = (a: Size, b: Size) => a.width === b.width && a.height === b.height;

export type Settler<T> = {
  push(value: T): void;
  cancel(): void;
  apply: (value: T) => void;
  interval: number;
};

export function createSettler<T>(apply: (value: T) => void, interval = SETTLE_MS, now: () => number = Date.now): Settler<T> {
  let last = -Infinity;
  let pending: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const settler: Settler<T> = {
    apply,
    interval,
    push(value) {
      const at = now();
      const quiet = at - last > settler.interval;
      last = at;
      if (quiet && !timer) {
        settler.apply(value);
        return;
      }
      pending = { value };
      timer ??= setTimeout(flush, settler.interval);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
  const flush = () => {
    timer = null;
    const due = pending;
    pending = null;
    if (due) settler.apply(due.value);
  };
  return settler;
}

export type Settled<T> = ((value: T) => void) & { cancel(): void };

export function useSettled<T>(apply: (value: T) => void, interval = SETTLE_MS): Settled<T> {
  const settler = useRef<Settler<T>>(null);
  settler.current ??= createSettler(apply, interval);
  settler.current.apply = apply;
  settler.current.interval = interval;
  useEffect(() => () => settler.current?.cancel(), []);
  const push = useRef<Settled<T>>(null);
  push.current ??= Object.assign((value: T) => settler.current?.push(value), { cancel: () => settler.current?.cancel() });
  return push.current;
}
