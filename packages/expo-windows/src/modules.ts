import { TurboModuleRegistry, type TurboModule } from "react-native";
import { windowsMotion } from "./animation/motion";
import { addNativeListener, type EventSubscription } from "./events";
import { moduleDefaults } from "./defaults";
import { engineAvailable } from "./engine/host";
import { engineModules } from "./engine/modules";
import { windowsImport } from "./import";
import { windowsInlineCompletion } from "./inlineCompletion";
import type { WindowsHostModule } from "./nativeModuleTypes";
import { windowsIntroMusic } from "./introMusic";
import { windowsExternalAppCounts } from "./engine/domains/externalApps";
import { windowsLaunchLinks } from "./launchLinks";
import { noteMissing } from "./missing";
import { stampedSystemInfo, windowsUpdater } from "./updater";
import { windowsSwipe } from "./pager";
import { setWindowDark } from "./windowDark";

type Listener = (payload: unknown) => void;
type NativeModule = TurboModule & Record<string, unknown>;

type Call = (...values: unknown[]) => unknown;

const modules = new Map<string, object>();

const RELEASE_NOTES_PAGE = "https://ardia.dev/release-notes";

const around: Record<string, Record<string, (native: Call) => Call>> = {
  ArdiaApp: {
    systemInfo: (native) => () => {
      const info = stampedSystemInfo(native());
      if (typeof info !== "object" || info === null) return info;
      return { releaseNotesURL: RELEASE_NOTES_PAGE, ...info };
    },
  },
  ArdiaAppWindows: {
    openWindow: (native) => (id, options) => {
      setWindowDark(String(id), !!(options as { incognito?: unknown } | null)?.incognito);
      return native(id, options);
    },
  },
};

const writtenInJs: Record<string, Record<string, unknown>> = { ArdiaUpdater: windowsUpdater, ArdiaSwipe: windowsSwipe, ArdiaMotion: windowsMotion, ArdiaLaunchLinks: windowsLaunchLinks, ArdiaExternalAppCounts: windowsExternalAppCounts, ArdiaImport: windowsImport(), ArdiaInlineCompletion: windowsInlineCompletion(() => TurboModuleRegistry.get<TurboModule & WindowsHostModule>("ArdiaWindowsHost")), ArdiaApp: windowsIntroMusic };

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
        const wrap = around[name]?.[key];
        if (wrap && typeof fromNative === "function") return wrap(fromNative as Call);
        if (fromNative !== undefined) return fromNative;
        if (Object.hasOwn(constants, key)) return constants[key];
        const inJs = writtenInJs[name];
        if (inJs && Object.hasOwn(inJs, key)) return inJs[key];
        const withEngine = engineModules[name];
        if (withEngine && Object.hasOwn(withEngine, key) && engineAvailable()) return withEngine[key];
        if (Object.hasOwn(defaults, key)) {
          noteMissing(`${name}.${key}`);
          return defaults[key];
        }
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
  return TurboModuleRegistry.get<TurboModule>(name) || moduleDefaults[name] || engineModules[name] || writtenInJs[name] ? (moduleOnWindows(name) as Module) : null;
}
