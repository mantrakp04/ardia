import type { AppEvent, CommandEvent, ConfirmOptions, InlineWrite, LaunchConfig, PromptOptions, SystemInfo, WindowEvent } from "@ardia-real/shell";
import { unstable_batchedUpdates } from "react-dom";
import { emitNativeEvent, provideNativeModule } from "./expo-modules-core";
import { NATIVE_CHANGE } from "./react-native";
import { setTrafficLightsCenter } from "./web/windowChrome";

export * from "@ardia-real/shell";
export { Symbol } from "./web/Symbol";
export { ActivitySpinner } from "./web/motion/ActivitySpinner";
export {
  ContextMenuArea,
  DockSelection,
  GlassEffect,
  OutsidePressArea,
  Surface,
  VisualEffect,
  WindowDragRegion,
} from "./web/chrome";
export { FadeLabel } from "./web/FadeLabel";
export { MouseArea } from "./web/MouseArea";
export { showMenu } from "./web/menus";

const SYSTEM_INFO: SystemInfo = {
  appName: "Ardia",
  appVersion: "demo",
  appBuild: "web",
  bundleId: "dev.ardia.demo",
  configuration: "Release",
  osVersion: "web",
  osBuild: "web",
  arch: "web",
  model: "web",
  memoryGB: 8,
  locale: typeof navigator === "undefined" ? "en-US" : navigator.language,
};

const LAUNCH_CONFIG: LaunchConfig = {
  dataDirectory: null,
  background: false,
  isolated: false,
  testInstance: false,
  instance: {},
  switches: {},
  trace: [],
  test: {},
};

provideNativeModule("ArdiaApp", {
  launchEnvironment: () => null,
  systemInfo: () => SYSTEM_INFO,
  launchConfig: () => LAUNCH_CONFIG,
  appIcons: async () => [],
  appIcon: async () => null,
});
provideNativeModule("ArdiaCalendar", { authorizationStatus: () => "notDetermined" });
provideNativeModule("ArdiaCli", { installedVersion: () => null });
provideNativeModule("ArdiaUserScripts", { watch: () => {}, read: async () => ({ state: "empty" }), readStatus: async () => null });

const documents = new Map<string, string>();
const darkQuery = typeof window === "undefined" ? null : window.matchMedia("(prefers-color-scheme: dark)");
let appearance: "auto" | "light" | "dark" = "auto";

provideNativeModule("ArdiaDocuments", {
  readDocument: (name: string) => documents.get(name) ?? null,
  writeDocument: (name: string, contents: string) => void documents.set(name, contents),
  saveDocument: async (name: string, contents: string) => void documents.set(name, contents),
  removeDocument: (name: string) => void documents.delete(name),
});
provideNativeModule("ArdiaShell", {
  fetchBangList: async (_etag: string | null) => ({ status: 304, etag: null, contentType: null, body: null, bytes: 0 }),
  copyText: (text: string) => void navigator.clipboard?.writeText(text).catch(() => {}),
  isDarkAppearance: async () => !!darkQuery?.matches,
  setAppearance: async (mode: "auto" | "light" | "dark") => {
    if (mode === appearance) return;
    appearance = mode;
    emitAppEvent({ type: "appearance", dark: mode === "auto" ? !!darkQuery?.matches : mode === "dark" });
  },
});
provideNativeModule("ArdiaDialogs", {
  confirm: async (options: ConfirmOptions) => ({
    confirmed: window.confirm([options.title, options.message].filter(Boolean).join("\n\n")),
    suppressed: false,
  }),
  prompt: async (options: PromptOptions) =>
    window.prompt(options.message ? `${options.title}\n\n${options.message}` : options.title, options.value ?? ""),
});
provideNativeModule("ArdiaAppWindows", {
  windowIds: async () => [] as string[],
  windowFrame: async (_id: string): Promise<[number, number, number, number] | null> => null,
  setTrafficLightsCenter: async (windowId: string, next: [number, number] | null) => setTrafficLightsCenter(windowId, next),
});
darkQuery?.addEventListener("change", (e) => appearance === "auto" && emitAppEvent({ type: "appearance", dark: e.matches }));

export const launchEnvironment = (_name: string) => null;

const valueSetter = typeof window === "undefined" ? undefined : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

export async function completeInline(tag: number, typed: string, completion: string): Promise<InlineWrite> {
  const field = tag as unknown as (HTMLInputElement & { [NATIVE_CHANGE]?: (text: string, selection: { start: number; end: number }) => void }) | null;
  if (!(field instanceof HTMLInputElement) || !valueSetter) return 0;
  if (field.value !== typed || document.activeElement !== field) return 2;
  const full = typed + completion;
  valueSetter.call(field, full);
  field.setSelectionRange(typed.length, full.length);
  unstable_batchedUpdates(() => field[NATIVE_CHANGE]?.(full, { start: typed.length, end: full.length }));
  return 1;
}

export const emitCommand = (event: CommandEvent) => emitNativeEvent("ArdiaMenus", "onCommand", event);
export const emitWindowEvent = (event: WindowEvent) => emitNativeEvent("ArdiaAppWindows", "onWindowEvent", event);
export const emitAppEvent = (event: AppEvent) => emitNativeEvent("ArdiaShell", "onAppEvent", event);
