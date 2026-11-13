import type { AppNative, DocumentsNative, SystemNative, SystemSignalsNative } from "@ardia/shell";
import { TurboModuleRegistry, type TurboModule } from "react-native";
import { requireNativeModule } from "../modules";
import { readBuild } from "../updater/manifest";
import { expectTrue, type Check } from "./check";

const app = () => requireNativeModule<AppNative & { windowsApiVersion?: number }>("ArdiaApp");
type DefaultBrowserState = { progId: string; command: string | null; registeredHere: boolean; http: string | null; https: string | null; page: string; isDefault: boolean };

const system = () => requireNativeModule<SystemNative & { defaultBrowserState(): DefaultBrowserState }>("ArdiaSystem");
const signals = () => requireNativeModule<SystemSignalsNative>("ArdiaSystemSignals");
const documents = () => requireNativeModule<DocumentsNative>("ArdiaDocuments");

const FILE_SETTLE_MS = 5000;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function untilFileExists(path: string, wanted: boolean) {
  const deadline = Date.now() + FILE_SETTLE_MS;
  while (Date.now() < deadline) {
    if ((await system().fileExists(path)) === wanted) return true;
    await pause(100);
  }
  return false;
}

const ARCHES = ["x64", "arm64"];

const buildFile = () => {
  const constants = TurboModuleRegistry.get<TurboModule>("ArdiaWindowsUpdate")?.getConstants?.() as { buildFile?: unknown } | undefined;
  return typeof constants?.buildFile === "string" ? readBuild(constants.buildFile) : null;
};

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const dataDirectory = () => {
  const directory = app().launchConfig().dataDirectory;
  expectTrue(typeof directory === "string" && directory.length > 0, `launchConfig().dataDirectory is ${JSON.stringify(directory)} under ARDIA_DATA_DIR`);
  return directory;
};

export const checks: Check[] = [
  {
    name: "ArdiaApp.launchConfig reads the CI instance",
    run() {
      const config = app().launchConfig();
      expectTrue(typeof config.configDirectory === "string" && config.configDirectory.length > 0, "configDirectory is empty");
      expectTrue(config.isolated === true, `isolated is ${JSON.stringify(config.isolated)} under ARDIA_DATA_DIR`);
      expectTrue(config.testInstance === true, `testInstance is ${JSON.stringify(config.testInstance)} under ARDIA_DATA_DIR`);
      expectTrue(config.background === true, `background is ${JSON.stringify(config.background)} under ARDIA_BACKGROUND=1`);
      expectTrue(config.instance !== null && typeof config.instance === "object", "instance is not an object");
      expectTrue(config.switches !== null && typeof config.switches === "object", "switches is not an object");
      expectTrue(Array.isArray(config.trace), "trace is not an array");
      expectTrue(config.test !== null && typeof config.test === "object", "test is not an object");
      dataDirectory();
    },
  },
  {
    name: "ArdiaApp.systemInfo is sane",
    run() {
      const info = app().systemInfo();
      expectTrue(typeof info.osVersion === "string" && info.osVersion.length > 0 && info.osVersion !== "0.0.0", `osVersion is ${JSON.stringify(info.osVersion)}`);
      expectTrue(isNumber(info.memoryGB) && info.memoryGB > 0, `memoryGB is ${JSON.stringify(info.memoryGB)}`);
      expectTrue(typeof info.appVersion === "string" && info.appVersion.length > 0, "appVersion is empty");
      expectTrue(info.isolatedInstance === true, `isolatedInstance is ${JSON.stringify(info.isolatedInstance)} under ARDIA_DATA_DIR`);
      const now = Date.now();
      expectTrue(isNumber(info.processStart) && info.processStart <= now && info.processStart > now - 3_600_000, `processStart is ${JSON.stringify(info.processStart)}, now ${now}`);
      expectTrue(isNumber(info.bootTime) && info.bootTime <= info.processStart, `bootTime is ${JSON.stringify(info.bootTime)}, processStart ${info.processStart}`);
      expectTrue(Number.isInteger(app().windowsApiVersion) && (app().windowsApiVersion as number) >= 1, `windowsApiVersion is ${JSON.stringify(app().windowsApiVersion)}`);
    },
  },
  {
    name: "ArdiaApp.systemInfo names this build, its CPU and Windows for telemetry",
    run() {
      const info = app().systemInfo();
      expectTrue(ARCHES.includes(info.arch), `arch is ${JSON.stringify(info.arch)}`);
      expectTrue(/^\d+\.\d+\.\d+$/.test(info.osVersion), `osVersion is ${JSON.stringify(info.osVersion)}`);
      const stamped = buildFile();
      if (!stamped) return;
      expectTrue(info.appVersion === stamped.version, `appVersion is ${JSON.stringify(info.appVersion)}, Ardia.build.json says ${stamped.version}`);
      expectTrue(info.appBuild === String(stamped.build), `appBuild is ${JSON.stringify(info.appBuild)}, Ardia.build.json says ${stamped.build}`);
    },
  },
  {
    name: "ArdiaApp.hardwareInfo and diagnosticsSample answer with numbers",
    async run() {
      const hardware = await app().hardwareInfo();
      expectTrue(typeof hardware.chip === "string", `chip is ${JSON.stringify(hardware.chip)}`);
      expectTrue(isNumber(hardware.memoryGB) && hardware.memoryGB > 0, `hardware memoryGB is ${JSON.stringify(hardware.memoryGB)}`);
      expectTrue(isNumber(hardware.displays) && hardware.displays >= 0, `displays is ${JSON.stringify(hardware.displays)}`);
      expectTrue(isNumber(hardware.maxScale) && hardware.maxScale >= 0, `maxScale is ${JSON.stringify(hardware.maxScale)}`);
      expectTrue(Object.values(hardware.hardwareDecode ?? {}).length === 4, `hardwareDecode is ${JSON.stringify(hardware.hardwareDecode)}`);
      const sample = await app().diagnosticsSample();
      expectTrue(isNumber(sample.footprintMB) && sample.footprintMB > 0, `footprintMB is ${JSON.stringify(sample.footprintMB)}`);
      expectTrue(isNumber(sample.freeDiskGB) && sample.freeDiskGB >= 0, `freeDiskGB is ${JSON.stringify(sample.freeDiskGB)}`);
    },
  },
  {
    name: "ArdiaApp answers the inert calls",
    async run() {
      const reports = await app().crashReports(0);
      expectTrue(Array.isArray(reports) && reports.length === 0, `crashReports is ${JSON.stringify(reports)}`);
      const icons = await app().appIcons(32);
      expectTrue(Array.isArray(icons), `appIcons is ${JSON.stringify(icons)}`);
      expectTrue((await app().appIcon()) === "", "appIcon is not empty");
      expectTrue((await app().isInDock()) === false, "isInDock is not false");
      expectTrue((await app().openExternalURL("file:///C:/Windows")) === false, "openExternalURL accepted a file URL");
    },
  },
  {
    name: "ArdiaSystem.fileExists sees the data directory",
    run() {
      expectTrue(system().backgroundInstance === true, `backgroundInstance is ${JSON.stringify(system().backgroundInstance)} under ARDIA_BACKGROUND=1`);
      const directory = dataDirectory();
      expectTrue(system().fileExists(directory) === true, `fileExists(${directory}) is not true`);
      const missing = `${directory}\\missing-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      expectTrue(system().fileExists(missing) === false, `fileExists(${missing}) is not false`);
      expectTrue(system().fileExists("") === false, "fileExists('') is not false");
    },
  },
  {
    name: "ArdiaSystem.launchAtLoginStatus and isDefaultBrowser answer",
    async run() {
      const status = await system().launchAtLoginStatus();
      expectTrue(["enabled", "requiresApproval", "notRegistered", "notFound"].includes(status), `launchAtLoginStatus is ${JSON.stringify(status)}`);
      expectTrue(typeof (await system().isDefaultBrowser()) === "boolean", "isDefaultBrowser is not a boolean");
      await system().setLaunchAtLogin(true);
      expectTrue((await system().launchAtLoginStatus()) === status, "setLaunchAtLogin changed the status from a background instance");
    },
  },
  {
    name: "ArdiaSystem.defaultBrowserState names Ardia's ProgID and agrees with isDefaultBrowser",
    async run() {
      const state = system().defaultBrowserState();
      expectTrue(state.progId === "ArdiaHTM", `progId is ${JSON.stringify(state.progId)}`);
      expectTrue(typeof state.registeredHere === "boolean" && typeof state.isDefault === "boolean", `registeredHere ${JSON.stringify(state.registeredHere)}, isDefault ${JSON.stringify(state.isDefault)}`);
      for (const scheme of ["http", "https"] as const) expectTrue(state[scheme] === null || typeof state[scheme] === "string", `${scheme} is ${JSON.stringify(state[scheme])}`);
      expectTrue(state.command === null || typeof state.command === "string", `command is ${JSON.stringify(state.command)}`);
      expectTrue(state.page.startsWith("ms-settings:defaultapps"), `page is ${JSON.stringify(state.page)}`);
      expectTrue(!state.isDefault || state.registeredHere, "isDefault without the ProgID pointing at this Ardia.exe");
      expectTrue((await system().isDefaultBrowser()) === state.isDefault, "isDefaultBrowser disagrees with defaultBrowserState");
    },
  },
  {
    name: "ArdiaSystem.fileIcon returns a PNG data URL or null",
    async run() {
      const directory = dataDirectory();
      for (const path of [directory, `${directory}\\missing.txt`]) {
        const icon = await system().fileIcon(path, 16);
        expectTrue(icon === null || (typeof icon === "string" && icon.startsWith("data:image/png;base64,") && icon.length > 40), `fileIcon(${path}) is ${JSON.stringify(icon?.slice(0, 60))}`);
      }
    },
  },
  {
    name: "ArdiaSystem file actions answer without opening anything",
    async run() {
      const missing = `${dataDirectory()}\\missing-${Date.now().toString(36)}`;
      expectTrue((await system().openFile(missing)) === false, "openFile of a missing file is not false");
      expectTrue((await system().revealFile(missing)) === false, "revealFile of a missing file is not false");
      expectTrue((await system().moveToTrash(missing)) === false, "moveToTrash of a missing file is not false");
      expectTrue((await system().revealFile(dataDirectory())) === true, "revealFile of the data directory is not true in the background");
      expectTrue((await system().setAsDefaultBrowser()) === false, "setAsDefaultBrowser is not false");
    },
  },
  {
    name: "ArdiaSystem moves a file to the Recycle Bin",
    async run() {
      const name = `self-check-trash-${Date.now().toString(36)}.txt`;
      const path = `${dataDirectory()}\\${name}`;
      documents().writeDocument(name, "self check");
      expectTrue(await untilFileExists(path, true), `${name} was never written`);
      expectTrue((await system().moveToTrash(path)) === true, "moveToTrash of a file in the data folder is not true");
      expectTrue(await untilFileExists(path, false), `${name} is still there after moveToTrash`);
    },
  },
  {
    name: "ArdiaWindowsUpdate knows this build and refuses other addresses",
    async run() {
      const update = requireNativeModule<{
        cpu?: unknown;
        installed?: unknown;
        buildFile?: unknown;
        fetchText(url: string): Promise<string>;
        download(url: string, sha256: string, bytes: number): Promise<string>;
        install(path: string, sha256: string): Promise<boolean>;
      }>("ArdiaWindowsUpdate");
      expectTrue(update.cpu === "x64" || update.cpu === "arm64", `cpu is ${JSON.stringify(update.cpu)}`);
      expectTrue(typeof update.installed === "boolean", `installed is ${JSON.stringify(update.installed)}`);
      expectTrue(typeof update.buildFile === "string", `buildFile is ${JSON.stringify(update.buildFile)}`);
      const published = "https://github.com/ardia-browser/ardia/releases/download/";
      const refused = async (what: string, call: Promise<unknown>) => {
        const outcome = await call.then(
          () => "answered",
          () => "refused",
        );
        expectTrue(outcome === "refused", `${what} was not refused`);
      };
      await refused("a feed from another site", update.fetchText("https://example.com/windows-update.json"));
      await refused("a feed that climbs out of the releases", update.fetchText(`${published}../../../../other/repo/releases/download/x/windows-update.json`));
      await refused("an installer from another site", update.download("https://example.com/Ardia-Setup.exe", "a".repeat(64), 10));
      await refused("an installer with no SHA-256", update.download(`${published}windows-alpha/Ardia-Setup-x64.exe`, "", 10));
      await refused("an installer with no size", update.download(`${published}windows-alpha/Ardia-Setup-x64.exe`, "a".repeat(64), 0));
      const state = await requireNativeModule<{ updaterState(): Promise<{ available: boolean; configured?: boolean }> }>("ArdiaUpdater").updaterState();
      expectTrue(state.available === true, "the updater says it is not built in");
      expectTrue(state.configured === (update.installed === true && typeof update.buildFile === "string" && update.buildFile.length > 0), `configured is ${String(state.configured)}`);
    },
  },
  {
    name: "ArdiaSystemSignals posts sleep and wake",
    async run() {
      const seen: string[] = [];
      const subscription = signals().addListener("onSystemSignal", (signal) => void seen.push(signal.type));
      try {
        expectTrue((await signals().devPost("willSleep")) === true, "devPost(willSleep) is not true in an isolated instance");
        expectTrue((await signals().devPost("didWake")) === true, "devPost(didWake) is not true in an isolated instance");
        const deadline = Date.now() + 2000;
        while (seen.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
        expectTrue(seen.join(",") === "sleep,wake", `signals seen: ${seen.join(",") || "none"}`);
        expectTrue(typeof signals().holdsIncomingLinks() === "boolean", "holdsIncomingLinks is not a boolean");
        signals().watchIdle([3600]);
        signals().watchIdle([]);
      } finally {
        subscription.remove();
      }
    },
  },
];
