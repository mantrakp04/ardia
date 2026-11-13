import { TurboModuleRegistry, type TurboModule } from "react-native";
import type { DomainModule } from "@ardia/ardiacore";
import type { AppNative, DocumentsNative } from "@ardia/shell";
import type { DialogsModule, SystemSignalsModule } from "../nativeModuleTypes";
import { engineAvailable } from "../engine/host";
import { nativeImportHost } from "../import/nativeHost";
import { requireNativeModule } from "../modules";
import { expectEqual, expectTrue, type Check } from "./check";

const PICKS = "file-chooser.txt";
const MANIFEST = "manifest.json";

const documents = () => requireNativeModule<DocumentsNative>("ArdiaDocuments");
const dataFolder = () => {
  const folder = requireNativeModule<Pick<AppNative, "launchConfig">>("ArdiaApp").launchConfig().dataDirectory;
  expectTrue(typeof folder === "string" && folder.length > 0, "the instance has no data folder");
  return folder;
};

function native<Module extends TurboModule>(name: string): Module {
  const found = TurboModuleRegistry.get<Module>(name);
  expectTrue(found, `${name} has no Windows module`);
  return found;
}

const isFlag = (value: unknown) => typeof value === "boolean";
const isCount = (value: unknown, most: number) => typeof value === "number" && value >= 0 && value <= most;

export const checks: Check[] = [
  {
    name: "desktop calls: the save panel answers cancelled, then the queued pick",
    async run() {
      const dialogs = native<TurboModule & DialogsModule>("ArdiaDialogs");
      expectEqual(await dialogs.saveFile("Ardia Bookmarks.html", "html", "Web page", ""), null, "a save panel nobody answered");
      const chosen = `${dataFolder()}\\self-check-export.html`;
      documents().writeDocument(PICKS, chosen);
      await documents().documentSaved(PICKS);
      expectEqual(await dialogs.saveFile("Ardia Passwords.csv", "csv", "CSV file", "Anyone who can open this file can read your passwords."), chosen, "the queued pick");
    },
  },
  {
    name: "desktop calls: the power state is a battery and memory reading",
    run() {
      const state = native<TurboModule & SystemSignalsModule>("ArdiaSystemSignals").powerState();
      expectTrue(isFlag(state.onBattery) && isFlag(state.batterySaver), `flags ${JSON.stringify(state)}`);
      expectTrue(state.batteryPercent === null || isCount(state.batteryPercent, 100), `battery ${JSON.stringify(state.batteryPercent)}`);
      expectTrue(isCount(state.memoryLoad, 100) && typeof state.physicalMemory === "number" && state.physicalMemory > 0, `memory ${JSON.stringify(state)}`);
    },
  },
  {
    name: "desktop calls: a read within a folder stays inside it",
    async run() {
      const files = nativeImportHost();
      expectTrue(files, "ArdiaWindowsImport has no Windows module");
      const name = "self-check-within.txt";
      documents().writeDocument(name, "inside");
      await documents().documentSaved(name);
      const folder = dataFolder();
      const file = `${folder}\\${name}`;
      expectEqual(await files.readTextWithin(folder, file, 1024), "inside", "a file inside the folder");
      expectEqual(await files.readTextWithin(`${folder}\\Chromium`, file, 1024), null, "a file outside the folder");
      expectEqual(await files.readTextWithin(`${folder}\\Chromium`, `${folder}\\Chromium\\..\\${name}`, 1024), null, "a path that climbs out of the folder");
      expectEqual(await files.readTextWithin(folder, file, 2), null, "a file over the size asked for");
      documents().removeDocument(name);
    },
  },
  {
    name: "desktop calls: engine.systemState has the Mac's shape and an unpacked folder reads as an install sheet",
    async run() {
      if (!engineAvailable()) return;
      const state = JSON.parse(await requireNativeModule<DomainModule>("ArdiaEngine").call("systemState", "", "{}")) as Record<string, unknown>;
      expectEqual(Object.keys(state).sort(), ["batteryLevel", "lowPowerMode", "memoryPressure", "onBattery", "physicalMemory"], "systemState's fields");
      expectTrue(["normal", "warning", "critical"].includes(String(state.memoryPressure)), `memoryPressure ${String(state.memoryPressure)}`);
      documents().writeDocument(MANIFEST, '{ "manifest_version": 3, "name": "Self Check", "version": "1.2", "permissions": ["storage", "https://*/*"], /* note */ }');
      await documents().documentSaved(MANIFEST);
      const sheet = JSON.parse(await requireNativeModule<DomainModule>("ArdiaExtensions").call("inspectUnpacked", "", JSON.stringify({ path: dataFolder() }))) as Record<string, unknown>;
      documents().removeDocument(MANIFEST);
      expectEqual(
        [sheet.name, sheet.version, sheet.manifestVersion, sheet.permissions, sheet.hostPermissions, sheet.path],
        ["Self Check", "1.2", 3, ["storage"], ["https://*/*"], dataFolder()],
        "the install sheet",
      );
    },
  },
];
