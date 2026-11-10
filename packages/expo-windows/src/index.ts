import { TurboModuleRegistry, type TurboModule } from "react-native";
import { addNativeListener, type EventSubscription } from "./events";
import { moduleDefaults } from "./defaults";
import { noteMissing } from "./missing";
import { viewOnWindows } from "./views";
import type { ComponentType } from "react";

export type { EventSubscription } from "./events";
export { emitNativeEvent } from "./events";
export { missingOnWindows } from "./missing";

type Listener = (payload: unknown) => void;
type NativeModule = TurboModule & Record<string, unknown>;

const modules = new Map<string, object>();

const inert = (module: string, key: string) => () => {
  noteMissing(`${module}.${key}`);
  return Promise.resolve(null);
};

function moduleOnWindows(name: string): object {
  const cached = modules.get(name);
  if (cached) return cached;
  const native = TurboModuleRegistry.get<TurboModule>(name) as NativeModule | null;
  const constants = (native?.getConstants?.() ?? {}) as Record<string, unknown>;
  const defaults = moduleDefaults[name] ?? {};
  const made = new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key !== "string" || key === "then" || key === "$$typeof") return undefined;
        const fromNative = native?.[key];
        if (fromNative !== undefined) return fromNative;
        if (key in constants) return constants[key];
        if (key in defaults) return defaults[key];
        if (key === "addListener") return (event: string, listener: Listener): EventSubscription => addNativeListener(name, event, listener);
        if (key === "removeListeners" || key === "removeAllListeners") return () => {};
        return inert(name, key);
      },
    },
  );
  modules.set(name, made);
  return made;
}

export function requireNativeModule<Module = unknown>(name: string): Module {
  return moduleOnWindows(name) as Module;
}

export function requireOptionalNativeModule<Module = unknown>(name: string): Module | null {
  return TurboModuleRegistry.get<TurboModule>(name) || moduleDefaults[name] ? (moduleOnWindows(name) as Module) : null;
}

export function requireNativeViewManager<Props = object>(name: string): ComponentType<Props> {
  return viewOnWindows(name) as ComponentType<Props>;
}

type WindowsHost = TurboModule & { secureRandomHex(byteCount: number): string };

const secureHex = (byteCount: number) => TurboModuleRegistry.getEnforcing<WindowsHost>("ArdiaWindowsHost").secureRandomHex(byteCount);

export const uuid = {
  v4() {
    const hex = secureHex(16);
    const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  },
};
