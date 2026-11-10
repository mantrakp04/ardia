import { useSyncExternalStore } from "react";
import { useColorScheme } from "react-native";
import { requireNativeModule } from "../modules";

type AppEvent = { type?: unknown; dark?: unknown };

type ShellAppearance = {
  isDarkAppearance(): Promise<boolean>;
  addListener(event: "onAppEvent", listener: (event: AppEvent) => void): { remove(): void };
};

let appDark: boolean | null = null;
let heardEvent = false;
let started = false;
const listeners = new Set<() => void>();

function publish(dark: boolean) {
  if (appDark === dark) return;
  appDark = dark;
  for (const listener of listeners) listener();
}

function start() {
  if (started) return;
  started = true;
  try {
    const shell = requireNativeModule<ShellAppearance>("ArdiaShell");
    shell.addListener("onAppEvent", (event) => {
      if (event?.type !== "appearance" || typeof event.dark !== "boolean") return;
      heardEvent = true;
      publish(event.dark);
    });
    void Promise.resolve(shell.isDarkAppearance())
      .then((dark) => {
        if (!heardEvent && typeof dark === "boolean") publish(dark);
      })
      .catch(() => {});
  } catch {
    appDark = null;
  }
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => appDark;

export function appDarkNow(): boolean | null {
  start();
  return appDark;
}

export function useAppDark(explicit?: unknown): boolean {
  const scheme = useColorScheme();
  const dark = useSyncExternalStore(subscribe, snapshot, snapshot);
  if (typeof explicit === "boolean") return explicit;
  return dark ?? scheme === "dark";
}
