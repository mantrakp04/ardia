import type { ConfigFileRead, LaunchConfig } from "@ardia/shell";
import { noteMissing } from "./missing";

const LAUNCH_CONFIG: LaunchConfig = {
  dataDirectory: null,
  configDirectory: "",
  background: false,
  isolated: false,
  testInstance: false,
  instance: {},
  switches: {},
  trace: [],
  test: {},
};

const documents = new Map<string, string>();

const ENGINE_ONLY: Record<string, string[]> = {
  ArdiaHistory: ["query", "add", "import", "deleteUrls", "watch"],
  ArdiaBookmarks: ["tree", "apply", "watch"],
  ArdiaFavicons: ["get", "set"],
  ArdiaTabs: ["lastTabPolicy"],
  ArdiaEngine: ["batterySaver", "trimMemory", "openTaskManager", "cliControlStatus", "setCliControl", "setCliActiveTab", "cliTabTargets"],
  ArdiaExtensions: ["watchActions", "syncState", "syncApply"],
  ArdiaDownloads: ["settings", "setSettings"],
};

const ENGINE_ANSWERS: Record<string, Record<string, unknown>> = {
  ArdiaTabs: { strips: { rev: 0, cmd: null, strips: [] } },
  ArdiaExtensions: { list: { extensions: [] } },
  ArdiaSearch: { engines: { list: { engines: [] } } },
};

const engineDomains = Object.fromEntries(
  [...new Set([...Object.keys(ENGINE_ONLY), ...Object.keys(ENGINE_ANSWERS)])].map((module) => [
    module,
    {
      call: async (name: string) => {
        if (ENGINE_ONLY[module]?.includes(name)) throw Object.assign(new Error(`${name} needs the engine, which Windows doesn't have yet`), { code: "ERR_ENGINE" });
        const answer = ENGINE_ANSWERS[module]?.[name];
        if (answer === undefined) noteMissing(`${module}.call ${name}`);
        return JSON.stringify(answer ?? null);
      },
    },
  ]),
);

export const moduleDefaults: Record<string, Record<string, unknown>> = {
  ...engineDomains,
  ArdiaApp: {
    launchEnvironment: () => null,
    launchConfig: () => LAUNCH_CONFIG,
    appIcons: async () => [],
    appIcon: async () => null,
  },
  ArdiaAppWindows: {
    windowIds: async () => [] as string[],
    windowFrame: async () => null,
  },
  ArdiaCalendar: { authorizationStatus: () => "notDetermined" },
  ArdiaCli: { installedVersion: () => null },
  ArdiaConfig: {
    readFile: (): ConfigFileRead => ({ status: "missing" }),
    watch: async () => {},
    writeSchemas: async () => [] as string[],
  },
  ArdiaDocuments: {
    readDocument: (name: string) => documents.get(name) ?? null,
    writeDocument: (name: string, contents: string) => void documents.set(name, contents),
    saveDocument: async (name: string, contents: string) => void documents.set(name, contents),
    removeDocument: (name: string) => void documents.delete(name),
  },
  ArdiaGlassEffect: { isLiquidGlass: () => false },
  ArdiaMenus: { menuShortcuts: async () => [] },
  ArdiaShell: {
    fetchBangList: async () => ({ status: 304, etag: null, contentType: null, body: null, bytes: 0 }),
    copyText: () => {},
    isDarkAppearance: async () => false,
    setAppearance: async () => {},
  },
  ArdiaSystem: { fileExists: () => false, hapticTick: () => {} },
  ArdiaTranslate: { available: false, userLanguages: () => ["en"], languageName: (id: string) => id },
  ArdiaUserScripts: { watch: () => {}, read: async () => ({ state: "empty" }), readStatus: async () => null },
};
