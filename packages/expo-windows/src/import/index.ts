import { TurboModuleRegistry, type TurboModule } from "react-native";
import type { DialogsNative } from "@ardia/shell";
import { emitNativeEvent } from "../events";
import { findBrowser } from "./browsers";
import { listSources } from "./discovery";
import { bookmarksFromHtml, passwordsFromCsv } from "./fileFormats";
import { pathFromFileUrl, type ImportHost } from "./host";
import { importProfile, Unlocks } from "./importer";
import { ImportFailure, type ImportKind, type Options, type Progress } from "./model";
import { nativeImportHost } from "./nativeHost";

type NativeOptions = Omit<Options, "historyPage">;

const LARGEST_FILE_BYTES = 64 << 20;
const NO_WRITE = { cookies: 0, cookiesRejected: 0, cookiesExisting: 0, addresses: 0, cards: 0 };

const failure = (code: string, message: string) => Object.assign(new Error(message), { code });

export function windowsImport(hostOf: () => ImportHost | null = nativeImportHost) {
  let host: ImportHost | null | undefined;
  const unlocks = new Unlocks();
  const cancelled = new Set<string>();
  const needHost = () => {
    host ??= hostOf();
    if (!host) throw failure("unsupported", "This build has no Windows import");
    return host;
  };
  const rethrown = (error: unknown): never => {
    if (error instanceof ImportFailure) throw failure(error.code, error.message);
    throw error;
  };
  const readFile = async (path: string) => {
    const text = await needHost().readText(path, LARGEST_FILE_BYTES);
    if (text == null) throw failure("unreadable", "The file could not be read");
    return text;
  };
  const fileName = (path: string) => path.slice(Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")) + 1);
  const notOnWindows = (what: string) => () => Promise.reject(failure("unsupported", `${what} isn't on Windows`));

  return {
    async listBrowsers(): Promise<string> {
      host ??= hostOf();
      return JSON.stringify(host ? await listSources(host) : []);
    },

    async importData(jobId: string, browserId: string, profileId: string, kinds: ImportKind[], options: NativeOptions): Promise<string> {
      const emit = (payload: object) => emitNativeEvent("ArdiaImport", "onImportEvent", { jobId, ...payload });
      try {
        const result = await importProfile(needHost(), unlocks, browserId, profileId, kinds, options ?? {}, {
          progress: (p: Progress) => emit({ type: "progress", ...p }),
          ...(options?.streamHistory ? { history: (entries) => emit({ type: "history", entries: JSON.stringify(entries) }) } : {}),
          cancelled: () => cancelled.has(jobId),
        });
        return JSON.stringify(result);
      } catch (error) {
        return rethrown(error);
      } finally {
        cancelled.delete(jobId);
      }
    },

    cancelImport(jobId: string) {
      cancelled.add(jobId);
    },

    async unlockBrowser(browserId: string): Promise<null> {
      const browser = findBrowser(browserId);
      if (!browser) throw failure("notFound", `Unknown browser ${browserId}`);
      await unlocks.ensure(needHost(), browser);
      return null;
    },

    isBrowserUnlocked: () => true,

    forgetUnlockedKeys() {
      if (host) unlocks.forget(host);
    },

    async writeImported(token: string, profile: string, kinds: string[]): Promise<string> {
      const native = needHost();
      if (!kinds.includes("cookies")) {
        native.discard(token);
        return JSON.stringify(NO_WRITE);
      }
      return JSON.stringify(await native.writeCookies(token, profile));
    },

    discardImported(token: string) {
      host?.discard(token);
    },

    listExtensions: async () => "[]",

    async importBookmarksHTML(path: string): Promise<string> {
      return JSON.stringify(await readFile(path).then((html) => bookmarksFromHtml(html, fileName(path)), rethrown));
    },

    async importPasswordsCSV(path: string): Promise<string> {
      return JSON.stringify(await readFile(path).then(passwordsFromCsv, rethrown));
    },

    async chooseImportFile(): Promise<string | null> {
      const dialogs = TurboModuleRegistry.get<TurboModule & Pick<DialogsNative, "pickFiles">>("ArdiaDialogs");
      const [picked] = (await dialogs?.pickFiles()) ?? [];
      if (!picked) return null;
      return pathFromFileUrl(picked);
    },

    importSafariExport: notOnWindows("Safari"),
    importSafariDirect: notOnWindows("Safari"),
    safariHasFullDiskAccess: () => false,
    openFullDiskAccessSettings: async () => null,
    readDiaTabs: notOnWindows("Dia"),
  };
}
