import { useEffect } from "react";
import { create } from "zustand";

export type Resource<A extends unknown[], T> = { name: string; fetch: (...args: A) => Promise<T> };

export const resource = <A extends unknown[], T>(name: string, fetch: (...args: A) => Promise<T>): Resource<A, T> => ({ name, fetch });

const keyOf = (name: string, args: unknown[]) => JSON.stringify([name, ...args]);

const useCache = create<Record<string, unknown>>()(() => ({}));
const running = new Map<string, Promise<unknown>>();
const generations = new Map<string, number>();

export function load<A extends unknown[], T>(r: Resource<A, T>, args: A, { fresh = false } = {}): Promise<T> {
  const key = keyOf(r.name, args);
  const current = running.get(key);
  if (current && !fresh) return current as Promise<T>;
  const generation = (generations.get(key) ?? 0) + 1;
  generations.set(key, generation);
  const job = r.fetch(...args).then(
    (value) => {
      if (generations.get(key) === generation) useCache.setState({ [key]: value });
      return value;
    },
  );
  const tracked = job.finally(() => running.get(key) === tracked && running.delete(key));
  running.set(key, tracked);
  return tracked;
}

export const cached = <A extends unknown[], T>(r: Resource<A, T>, args: A): T | undefined => useCache.getState()[keyOf(r.name, args)] as T | undefined;

export function store<A extends unknown[], T>(r: Resource<A, T>, args: A, value: T) {
  const key = keyOf(r.name, args);
  generations.set(key, (generations.get(key) ?? 0) + 1);
  useCache.setState({ [key]: value });
}

export function useResource<A extends unknown[], T>(r: Resource<A, T>, ...args: A): [T | undefined, () => Promise<T | undefined>] {
  const key = keyOf(r.name, args);
  const value = useCache((s) => s[key]) as T | undefined;
  useEffect(() => {
    load(r, args).catch(() => {});
  }, [key]);
  return [value, () => load(r, args, { fresh: true }).catch(() => undefined)];
}

export type Needed = [Resource<never[], unknown>, unknown[]];
export const need = <A extends unknown[], T>(r: Resource<A, T>, ...args: A): Needed => [r as unknown as Resource<never[], unknown>, args];

export function useAllLoaded(needed: Needed[]): boolean {
  const keys = needed.map(([r, args]) => keyOf(r.name, args));
  return useCache((s) => keys.every((k) => k in s));
}

export const loadAll = (needed: Needed[]) => Promise.allSettled(needed.map(([r, args]) => load(r, args as never[])));
