import { useMemo, useSyncExternalStore } from "react";
import { changedIds } from "./changes";
import { useBrowser, type BrowserState } from "./store";

type Readable<S> = { getState(): S; subscribe(listener: (s: S, prev: S) => void): () => void };
type Listener = () => void;
export type WakeAll = true;
export type Changes<S> = (s: S, prev: S, wake: (key: string) => void) => WakeAll | void;
export type KeyedWatch = (key: string, listener: Listener) => () => void;

const subscribeOf = <S,>(store: Readable<S>): Readable<S>["subscribe"] => (store.subscribe as { unprobed?: Readable<S>["subscribe"] }).unprobed ?? store.subscribe;

export function keyedWatch<S>(store: () => Readable<S>, changes: Changes<S>): KeyedWatch {
  const byKey = new Map<string, Set<Listener>>();
  let listening = false;
  const hear = (s: S, prev: S) => {
    if (s === prev || !byKey.size) return;
    const woken = new Set<Listener>();
    const wake = (key: string) => {
      const listeners = byKey.get(key);
      if (listeners) for (const listener of listeners) woken.add(listener);
    };
    if (changes(s, prev, wake) === true) for (const listeners of byKey.values()) for (const listener of listeners) woken.add(listener);
    for (const listener of woken) listener();
  };
  return (key, listener) => {
    if (!listening) {
      listening = true;
      subscribeOf(store())(hear);
    }
    let listeners = byKey.get(key);
    if (!listeners) byKey.set(key, (listeners = new Set()));
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size && byKey.get(key) === listeners) byKey.delete(key);
    };
  };
}

export const recordWatch = <S, R extends Record<string, unknown>>(store: () => Readable<S>, pick: (s: S) => R): KeyedWatch =>
  keyedWatch(store, (s, prev, wake) => {
    const next = pick(s);
    const before = pick(prev);
    if (next !== before) for (const id of changedIds(next, before)) wake(id);
  });

export const fieldWatch = <S,>(store: () => Readable<S>, pick: (s: S) => unknown): KeyedWatch =>
  keyedWatch(store, (s, prev) => (pick(s) !== pick(prev) ? true : undefined));

const inert: (listener: Listener) => () => void = Object.assign(() => () => {}, { inert: true });

export function useKeyed<T>(watch: KeyedWatch, key: string | null | undefined, read: () => T): T {
  const subscribe = useMemo(() => (key == null ? inert : (listener: Listener) => watch(key, listener)), [watch, key]);
  return useSyncExternalStore(subscribe, read, read);
}

const browser = () => useBrowser;

export const watchTabRecord = recordWatch(browser, (s: BrowserState) => s.tabs);
export const watchLiveRecord = recordWatch(browser, (s: BrowserState) => s.live);
export const watchWindowRecord = recordWatch(browser, (s: BrowserState) => s.windows);
export const watchSettings = fieldWatch(browser, (s: BrowserState) => s.settings);
export const watchAppDark = fieldWatch(browser, (s: BrowserState) => s.ui.appDark);
export const ALL = "";
