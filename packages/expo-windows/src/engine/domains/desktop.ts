import type { DialogsNative } from "@ardia/shell";
import { TurboModuleRegistry, type TurboModule } from "react-native";
import { nativeImportHost } from "../../import/nativeHost";
import type { Desktop, PowerReading } from "./calling";

export type WindowsDialogs = TurboModule &
  Pick<DialogsNative, "pickFolder"> & { saveFile(name: string, extension: string, kind: string, message: string): Promise<string | null> };
export type WindowsPower = TurboModule & { powerState(): PowerReading };

const dialogs = () => TurboModuleRegistry.get<WindowsDialogs>("ArdiaDialogs");
const signals = () => TurboModuleRegistry.get<WindowsPower>("ArdiaSystemSignals");

export function nativeDesktop(): Desktop | undefined {
  const files = nativeImportHost();
  if (!dialogs() || !files) return undefined;
  return {
    saveFile: async ({ name, extension, kind, message }) => (await dialogs()?.saveFile(name, extension, kind, message)) ?? null,
    pickFolder: async (prompt) => (await dialogs()?.pickFolder(null, prompt)) ?? null,
    readText: (folder, path, largest) => files.readTextWithin(folder, path, largest),
    readBase64: (folder, path, largest) => files.readBase64Within(folder, path, largest),
    power: () => signals()?.powerState() ?? null,
    every: (ms, run) => void setInterval(run, ms),
  };
}
