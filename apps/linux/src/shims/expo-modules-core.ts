import { createElement, forwardRef, type ComponentType } from "react";
import { View } from "react-native-web";
import { noteMissing } from "./missing";
import { ardiaHost, hostSupports } from "../host";
import { createNativeEvents } from "../hostEvents";
import { resolveHostModule } from "../hostModules";

export type EventSubscription = { remove(): void };

export const uuid = { v4: (): string => crypto.randomUUID() };

type Listener = (event: unknown) => void;
const events = createNativeEvents();

ardiaHost?.onEvent((module, event, payload) => emitNativeEvent(module, event, payload));

let sharedCommand: (command: string) => boolean = () => true;

export const setSharedCommands = (known: (command: string) => boolean) => void (sharedCommand = known);

const LINUX_COMMAND_EVENT = "onLinuxCommand";

export const onLinuxCommand = (listener: Listener): EventSubscription => events.add("ArdiaShell", LINUX_COMMAND_EVENT, listener);

export function emitNativeEvent(module: string, event: string, payload: unknown) {
  if (module === "ArdiaShell" && event === "onCommand") {
    events.emit(module, LINUX_COMMAND_EVENT, payload);
    const command = (payload as { command?: unknown } | null)?.command;
    if (typeof command === "string" && !sharedCommand(command)) return;
  }
  events.emit(module, event, payload);
}

const moduleValues: Record<string, Record<string, unknown>> = {
  ArdiaTranslate: { available: false, userLanguages: () => ["en"], languageName: (id: string) => id },
  ArdiaGlassEffect: { isLiquidGlass: () => true },
  ArdiaShell: { readDocument: () => null, writeDocument: () => {}, removeDocument: () => {}, copyText: () => {} },
  ArdiaSystem: { fileExists: () => false, hapticTick: () => {} },
};

export function provideNativeModule(name: string, values: Record<string, unknown>) {
  moduleValues[name] = { ...moduleValues[name], ...values };
}

type ModuleProvider = (name: string, method: string) => unknown;
const moduleProviders: ModuleProvider[] = [];

export function provideNativeModuleProvider(provider: ModuleProvider) {
  moduleProviders.push(provider);
  return () => {
    const index = moduleProviders.indexOf(provider);
    if (index >= 0) moduleProviders.splice(index, 1);
  };
}

const inert = (module: string, key: string) => () => {
  noteMissing(`${module}.${key}`);
  return Promise.resolve(null);
};

const SHELL_PARTS = ["ArdiaAppWindows", "ArdiaFocus", "ArdiaMenus", "ArdiaDialogs"];
const APP_PARTS = ["ArdiaUpdater", "ArdiaNotifications", "ArdiaScripting", "ArdiaDev"];
const SHELL_DOCUMENT_METHODS = ["readDocument", "writeDocument", "saveDocument", "removeDocument", "refreshDocument", "deleteDocument"];

export function hostModuleName(name: string, method?: string): string {
  if (SHELL_PARTS.includes(name)) return "ArdiaShell";
  if (APP_PARTS.includes(name)) return "ArdiaApp";
  if (name === "ArdiaDocuments" && method !== undefined && SHELL_DOCUMENT_METHODS.includes(method)) return "ArdiaShell";
  return name;
}

const modules = new Map<string, object>();

function nativeModule(name: string): object {
  const cached = modules.get(name);
  if (cached) return cached;
  const made = new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key === "symbol" || key === "then" || key === "$$typeof") return undefined;
        const host = hostModuleName(name);
        if (key === "addListener")
          return (event: string, listener: Listener): EventSubscription => events.add(host, event, listener);
        if (key === "removeAllListeners") return (event?: string) => events.removeAll(host, event);
        if (key === "removeListeners") return () => {};
        const target = hostModuleName(name, key);
        for (const provider of moduleProviders) {
          const value = provider(target, key);
          if (value !== undefined) return value;
        }
        if (ardiaHost) {
          return resolveHostModule(ardiaHost, target, key);
        }
        const values = moduleValues[target];
        if (values && key in values) return values[key];
        return inert(target, key);
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
  const host = hostModuleName(name);
  if (ardiaHost) return ardiaHost.bootstrap.nativeModules?.[host] || ardiaHost.bootstrap.capabilities?.some((method) => method.startsWith(`${host}.`)) || hostSupports(host) ? (nativeModule(name) as T) : null;
  return moduleValues[host] ? (nativeModule(name) as T) : null;
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
