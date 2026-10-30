import type { AppEvent, CommandEvent, ConfirmOptions, InlineWrite, PromptOptions, SystemInfo, WindowEvent } from "@ardia-real/shell";
export * from "@ardia-real/shell";
import { unstable_batchedUpdates } from "react-dom";
import { emitNativeEvent, provideNativeModule, provideNativeModuleProvider } from "./expo-modules-core";
import { NATIVE_CHANGE } from "./react-native";
import { ardiaHost, hostModuleMethod, reportHostError } from "../host";
import { hostLaunchConfig } from "../hostLaunchConfig";
import { createFolderPicker } from "../hostFolders";
import { linuxHostDialogs } from "../hostDialogs";
import { createHostDocuments } from "../hostDocuments";
import { createHostWindowOpener, dropRefusedWindow } from "../hostWindowProfiles";
import { createLinuxWindowIds } from "../windowSweep";
import { useBrowser } from "../../../browser/src/state/browser/store";

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
export { FileDropArea } from "./web/FileDropArea";
export { PopoverBubble } from "./web/PopoverBubble";
export { showMenu } from "../menus";
import { setTrafficLightsCenter } from "./web/windowChrome";
export { setTrafficLightsCenter };
export { fetchBangList } from "../shellMethods";

const SYSTEM_INFO: SystemInfo = {
  appName: "Ardia",
  appVersion: "linux-dev",
  appBuild: "host",
  bundleId: "dev.ardia.linux",
  configuration: "Release",
  osVersion: "Linux",
  osBuild: "Linux",
  arch: "unknown",
  model: "Linux",
  memoryGB: 8,
  locale: typeof navigator === "undefined" ? "en-US" : navigator.language,
};

provideNativeModule("ArdiaApp", { launchConfig: () => hostLaunchConfig(), systemInfo: () => SYSTEM_INFO });
provideNativeModule("ArdiaCalendar", { authorizationStatus: () => "notDetermined" });

const documents = new Map<string, string>();
const hostDocuments = ardiaHost ? createHostDocuments(ardiaHost) : undefined;
export const readDocument = (name: string) => hostDocuments ? hostDocuments.read(name) : documents.get(name) ?? null;
export const writeDocument = (name: string, contents: string) => hostDocuments ? void hostDocuments.write(name, contents).catch(reportHostError) : void documents.set(name, contents);
export const saveDocument = async (name: string, contents: string) => hostDocuments ? hostDocuments.write(name, contents) : void documents.set(name, contents);
export const removeDocument = (name: string) => hostDocuments ? void hostDocuments.remove(name).catch(reportHostError) : void documents.delete(name);
export const refreshDocument = async (name: string) => hostDocuments ? hostDocuments.refresh(name) : documents.has(name);
export const deleteDocument = async (name: string) => hostDocuments ? hostDocuments.remove(name) : void documents.delete(name);

export function copyText(text: string) {
  if (ardiaHost) return void hostModuleMethod("ArdiaShell", "copyText")(text).catch(reportHostError);
  void navigator.clipboard?.writeText(text).catch(() => {});
}

export const confirm = async (options: ConfirmOptions): Promise<{ confirmed: boolean; suppressed: boolean }> => ardiaHost ? hostModuleMethod("ArdiaShell", "confirm")(options) as Promise<{ confirmed: boolean; suppressed: boolean }> : ({
  confirmed: window.confirm([options.title, options.message].filter(Boolean).join("\n\n")),
  suppressed: false,
});

export const prompt = async (options: PromptOptions) =>
  ardiaHost ? hostModuleMethod("ArdiaShell", "prompt")(options) as Promise<string | null> : window.prompt(options.message ? `${options.title}\n\n${options.message}` : options.title, options.value ?? "");

const darkQuery = typeof window === "undefined" ? null : window.matchMedia("(prefers-color-scheme: dark)");
export const isDarkAppearance = async () => appearance === "auto" ? !!darkQuery?.matches : appearance === "dark";
let appearance: "auto" | "light" | "dark" = "auto";
export const setAppearance = async (mode: "auto" | "light" | "dark") => {
  if (mode === appearance) return;
  appearance = mode;
  emitAppEvent({ type: "appearance", dark: mode === "auto" ? !!darkQuery?.matches : mode === "dark" });
};
darkQuery?.addEventListener("change", (e) => appearance === "auto" && emitAppEvent({ type: "appearance", dark: e.matches }));

export const windowIds = ardiaHost ? createLinuxWindowIds(ardiaHost, () => useBrowser.getState()) : async () => [] as string[];
export const windowFrame = async (id: string): Promise<[number, number, number, number] | null> => ardiaHost ? hostModuleMethod("ArdiaShell", "windowFrame")(id) as Promise<[number, number, number, number] | null> : null;
export const systemInfo = (): SystemInfo => ardiaHost ? (ardiaHost.bootstrap.nativeModules?.ArdiaApp?.systemInfo as SystemInfo | undefined) ?? { ...SYSTEM_INFO, appVersion: "linux-dev", appBuild: "host", bundleId: "dev.ardia.linux", osVersion: "Linux", osBuild: "Linux", arch: "unknown", model: "Linux" } : SYSTEM_INFO;
export const launchConfig = () => hostLaunchConfig(ardiaHost);

const claimHostFocus = async (generation: number, tag: number) => {
  const node = tag as unknown;
  if (node instanceof HTMLElement) node.focus();
  else await hostModuleMethod("ArdiaShell", "claimFocus")(generation, tag);
};
const openHostWindow = ardiaHost ? createHostWindowOpener(ardiaHost, () => useBrowser.getState(), (event) => emitWindowEvent(event), (id) => dropRefusedWindow(useBrowser, id)) : undefined;
const pickHostFolder = ardiaHost ? createFolderPicker(ardiaHost, (options) => linuxHostDialogs().confirm(options).then((answer) => answer.confirmed)) : undefined;
const hostShellLocals: Record<string, unknown> = { readDocument, writeDocument, saveDocument, removeDocument, claimFocus: claimHostFocus, openWindow: openHostWindow, pickFolder: pickHostFolder };
const hostAppLocals: Record<string, unknown> = { systemInfo, launchConfig };
provideNativeModuleProvider((module, method) => ardiaHost ? (module === "ArdiaShell" ? hostShellLocals[method] : module === "ArdiaApp" ? hostAppLocals[method] : undefined) : undefined);
const shellLocals: Record<string, unknown> = {
  setAppearance,
  isDarkAppearance,
  windowIds,
  setTrafficLightsCenter: async (id: string, center: [number, number] | null) => setTrafficLightsCenter(id, center),
};
provideNativeModuleProvider((module, method) => module === "ArdiaShell" && Object.hasOwn(shellLocals, method) ? shellLocals[method] : undefined);

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
