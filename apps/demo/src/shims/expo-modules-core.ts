import { createElement, forwardRef, type ComponentType } from "react";
import { View } from "react-native-web";
import { noteMissing } from "./missing";

export type EventSubscription = { remove(): void };

type Listener = (event: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
const channel = (module: string, event: string) => `${module}:${event}`;

export function emitNativeEvent(module: string, event: string, payload: unknown) {
  for (const listener of listeners.get(channel(module, event)) ?? []) listener(payload);
}

const moduleValues: Record<string, Record<string, unknown>> = {
  ArdiaTranslate: { available: false, userLanguages: () => ["en"], languageName: (id: string) => id },
  ArdiaGlassEffect: { isLiquidGlass: () => true },
  ArdiaShell: { copyText: () => {} },
  ArdiaDocuments: { readDocument: () => null, writeDocument: () => {}, removeDocument: () => {} },
  ArdiaSystem: { fileExists: () => false, hapticTick: () => {} },
  ArdiaMenus: { menuShortcuts: async () => [] },
};

export function provideNativeModule(name: string, values: Record<string, unknown>) {
  moduleValues[name] = { ...moduleValues[name], ...values };
}

const inert = (module: string, key: string) => () => {
  noteMissing(`${module}.${key}`);
  return Promise.resolve(null);
};

const modules = new Map<string, object>();

function nativeModule(name: string): object {
  const cached = modules.get(name);
  if (cached) return cached;
  const made = new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key === "symbol" || key === "then" || key === "$$typeof") return undefined;
        const values = moduleValues[name];
        if (values && key in values) return values[key];
        if (key === "addListener")
          return (event: string, listener: Listener): EventSubscription => {
            const id = channel(name, event);
            const set = listeners.get(id) ?? new Set();
            set.add(listener);
            listeners.set(id, set);
            return { remove: () => void set.delete(listener) };
          };
        if (key === "removeListeners" || key === "removeAllListeners") return () => {};
        return inert(name, key);
      },
    },
  );
  modules.set(name, made);
  return made;
}

export function requireNativeModule<T = unknown>(name: string): T {
  return nativeModule(name) as T;
}

export function requireOptionalNativeModule<T = unknown>(name: string): T | null {
  return moduleValues[name] ? (nativeModule(name) as T) : null;
}

const viewManagers = new Map<string, ComponentType<object>>();

export function requireNativeViewManager<P = object>(name: string): ComponentType<P> {
  const cached = viewManagers.get(name);
  if (cached) return cached as ComponentType<P>;
  const placeholder = forwardRef<unknown, object & { children?: unknown }>(function NativeViewPlaceholder(props, ref) {
    noteMissing(`<${name}>`);
    return createElement(View as ComponentType<Record<string, unknown>>, { pointerEvents: "box-none", ...props, ref });
  });
  placeholder.displayName = name;
  viewManagers.set(name, placeholder as ComponentType<object>);
  return placeholder as unknown as ComponentType<P>;
}

export class EventEmitter {}
export class NativeModule {}
export const Platform = { OS: "web" };

export const uuid = { v4: () => crypto.randomUUID() };
