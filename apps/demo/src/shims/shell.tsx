import type { AppEvent, CommandEvent, ConfirmOptions, InlineWrite, LaunchConfig, PromptOptions, SystemInfo, WindowEvent } from "@ardia-real/shell";
import { unstable_batchedUpdates } from "react-dom";
import { emitNativeEvent, provideNativeModule } from "./expo-modules-core";
import { NATIVE_CHANGE } from "./react-native";

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
export { setTrafficLightsCenter } from "./web/windowChrome";

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

const documents = new Map<string, string>();
export const readDocument = (name: string) => documents.get(name) ?? null;
export const writeDocument = (name: string, contents: string) => void documents.set(name, contents);
export const fetchBangList = (_etag: string | null): Promise<{ status: number; etag: string | null; contentType: string | null; body: string | null; bytes: number }> =>
  Promise.resolve({ status: 304, etag: null, contentType: null, body: null, bytes: 0 });
export const saveDocument = async (name: string, contents: string) => void documents.set(name, contents);
export const removeDocument = (name: string) => void documents.delete(name);

export function copyText(text: string) {
  void navigator.clipboard?.writeText(text).catch(() => {});
}

export const confirm = async (options: ConfirmOptions) => ({
  confirmed: window.confirm([options.title, options.message].filter(Boolean).join("\n\n")),
  suppressed: false,
});

export const prompt = async (options: PromptOptions) =>
  window.prompt(options.message ? `${options.title}\n\n${options.message}` : options.title, options.value ?? "");

const darkQuery = typeof window === "undefined" ? null : window.matchMedia("(prefers-color-scheme: dark)");
export const isDarkAppearance = async () => !!darkQuery?.matches;
let appearance: "auto" | "light" | "dark" = "auto";
export const setAppearance = async (mode: "auto" | "light" | "dark") => {
  if (mode === appearance) return;
  appearance = mode;
  emitAppEvent({ type: "appearance", dark: mode === "auto" ? !!darkQuery?.matches : mode === "dark" });
};
darkQuery?.addEventListener("change", (e) => appearance === "auto" && emitAppEvent({ type: "appearance", dark: e.matches }));

export const windowIds = async () => [] as string[];
export const windowFrame = async (_id: string): Promise<[number, number, number, number] | null> => null;
export const systemInfo = () => SYSTEM_INFO;
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

export const emitCommand = (event: CommandEvent) => emitNativeEvent("ArdiaShell", "onCommand", event);
export const emitWindowEvent = (event: WindowEvent) => emitNativeEvent("ArdiaShell", "onWindowEvent", event);
export const emitAppEvent = (event: AppEvent) => emitNativeEvent("ArdiaShell", "onAppEvent", event);
