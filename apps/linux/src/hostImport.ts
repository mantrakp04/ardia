import type * as ImportApi from "../../../packages/import/src/index.ts";
import type { ArdiaHost } from "./host";
import { invokeHost, reportHostError } from "./host.ts";
import { issueImportHandles } from "./importHandles.ts";

type Api = typeof ImportApi;
type ImportErrorClass = new (code: string, message: string) => Error & { code: string };
type ImportEvent = { jobId?: unknown; type?: unknown; [key: string]: unknown };

export type PendingPasswords = { token: string; count: number };
export type WrittenPasswords = { added: number; existing: number; conflicts: number; invalid: number };

export const IMPORT_MODULE = "ArdiaImport";
export const IMPORT_EVENT = "onImportEvent";
export const IMPORT_IDLE_MS = 120_000;
export const CHOOSER_DEADLINE_MS = 30 * 60_000;
export const UNLOCK_DEADLINE_MS = 150_000;
export const UNLOCK_LIFETIME_MS = 10 * 60_000;
const HISTORY_CHUNK = 500;
const TOKEN = /^[0-9a-f]{32}$/;

type Clock = { schedule(run: () => void, ms: number): unknown; cancel(handle: unknown): void; now?(): number };
const realClock: Clock = { schedule: (run, ms) => setTimeout(run, ms), cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>), now: () => Date.now() };

const count = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0);

export function pendingPasswords(result: unknown): PendingPasswords | null {
  const passwords = (result as { passwords?: unknown } | null)?.passwords as { token?: unknown; count?: unknown } | undefined;
  if (!passwords || typeof passwords.token !== "string" || !TOKEN.test(passwords.token)) return null;
  return { token: passwords.token, count: count(passwords.count) };
}

function writtenImported(reply: unknown): ImportApi.WrittenCounts {
  const value = (reply ?? {}) as Record<string, unknown>;
  const counts: ImportApi.WrittenCounts = {
    cookies: count(value.cookies),
    cookiesRejected: count(value.cookiesRejected),
    cookiesExisting: count(value.cookiesExisting),
    addresses: count(value.addresses),
    cards: count(value.cards),
  };
  if (value.cookiesFailed === 1) counts.cookiesFailed = 1;
  if (value.autofillFailed === 1) counts.autofillFailed = 1;
  return counts;
}

function writtenPasswords(reply: unknown): WrittenPasswords {
  const value = (reply ?? {}) as Record<string, unknown>;
  return { added: count(value.added), existing: count(value.existing), conflicts: count(value.conflicts), invalid: count(value.invalid) };
}

export type UnlockOptions = { primaryPassword?: string; profiles?: readonly string[]; kinds?: readonly string[] };

export type HostImport = Pick<
  Api,
  | "listBrowsers"
  | "importData"
  | "unlockBrowser"
  | "isBrowserUnlocked"
  | "forgetUnlockedKeys"
  | "writeImported"
  | "discardImported"
  | "listExtensions"
  | "importSafariExport"
  | "safariHasFullDiskAccess"
  | "openFullDiskAccessSettings"
  | "importSafariDirect"
  | "importBookmarksHTML"
  | "importPasswordsCSV"
  | "chooseImportFile"
  | "readDiaTabs"
> & {
  writePasswords(token: string, profile: string): Promise<WrittenPasswords>;
  discardPasswords(token: string): void;
};

export function createHostImport(host: ArdiaHost, ImportError: ImportErrorClass, clock: Clock = realClock): HostImport {
  const families = new Map<string, string>();
  const keychains = new Set<string>();
  const unlocked = new Map<string, number>();
  const now = () => clock.now?.() ?? Date.now();
  const stillUnlocked = (browserId: string) => {
    const at = unlocked.get(browserId);
    if (at === undefined) return false;
    if (now() - at < UNLOCK_LIFETIME_MS) return true;
    unlocked.delete(browserId);
    return false;
  };
  let sequence = 0;
  const failure = (code: string, message: string) => new ImportError(code, message);
  const unsupported = (what: string) => Promise.reject(failure("unsupported", `${what} isn't available on Linux`));
  const invoke = <T,>(method: string, args: unknown[]) =>
    invokeHost<T>(`${IMPORT_MODULE}.${method}`, { args }, host).catch((error: { code?: string; message?: string }) => {
      throw failure(error?.code && error.code !== "ERR_ENGINE" ? error.code : "unreadable", error?.message ?? String(error));
    });
  const nextId = (prefix: string) => `${prefix}-${host.bootstrap.windowId}-${++sequence}`.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 64);

  function awaitEvents(id: string, onEvent: (event: ImportEvent) => boolean, idleMs: number, onIdle: () => void) {
    let stop = () => {};
    const done = new Promise<void>((resolve) => {
      let timer: unknown;
      const arm = () => {
        if (timer !== undefined) clock.cancel(timer);
        timer = clock.schedule(() => {
          stop();
          onIdle();
        }, idleMs);
      };
      const unsubscribe = host.onEvent((module, name, payload) => {
        if (module !== IMPORT_MODULE || name !== IMPORT_EVENT) return;
        const event = payload as ImportEvent;
        if (!event || event.jobId !== id) return;
        arm();
        if (onEvent(event)) stop();
      });
      stop = () => {
        if (timer !== undefined) clock.cancel(timer);
        unsubscribe();
        resolve();
      };
      arm();
    });
    return { done, stop: () => stop() };
  }

  const importData: Api["importData"] = (browserId, profileId, kinds, options = {}) => {
    if (options.signal?.aborted) return Promise.reject(failure("cancelled", "Import cancelled"));
    const jobId = nextId("import");
    return new Promise<ImportApi.ImportResult>((resolve, reject) => {
      let settled = false;
      const finish = (run: () => void) => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener("abort", abort);
        watch.stop();
        run();
      };
      const cancel = () => void invoke("cancelImport", [jobId]).catch(reportHostError);
      const discardLate = () =>
        awaitEvents(
          jobId,
          (event) => {
            if (event.type === "progress") return false;
            const late = event.type === "done" ? pendingPasswords(event.result) : null;
            if (late) void invoke("discardPasswords", [late.token]).catch(reportHostError);
            return true;
          },
          IMPORT_IDLE_MS,
          () => {},
        );
      const abort = () => {
        cancel();
        finish(() => reject(failure("cancelled", "Import cancelled")));
        discardLate();
      };
      const watch = awaitEvents(
        jobId,
        (event) => {
          if (event.type === "progress") {
            const phase = event.phase;
            if (typeof event.kind === "string" && (phase === "start" || phase === "progress" || phase === "end")) {
              options.onProgress?.({ kind: event.kind as ImportApi.ImportKind, phase, processed: count(event.processed), total: typeof event.total === "number" ? event.total : undefined });
            }
            return false;
          }
          if (event.type === "done") {
            const result = normalizeResult(event.result, browserId, profileId);
            if (options.onHistoryChunk && result.history.length) {
              const size = options.chunkSize && options.chunkSize > 0 ? options.chunkSize : HISTORY_CHUNK;
              for (let start = 0; start < result.history.length; start += size) options.onHistoryChunk(result.history.slice(start, start + size));
              result.history = [];
            }
            finish(() => resolve(result));
            return true;
          }
          if (event.type === "failed") {
            finish(() => reject(failure(typeof event.code === "string" ? event.code : "unreadable", typeof event.message === "string" ? event.message : "Import failed")));
            return true;
          }
          return false;
        },
        IMPORT_IDLE_MS,
        () => {
          cancel();
          finish(() => reject(failure("timeout", "The import stopped responding")));
        },
      );
      options.signal?.addEventListener("abort", abort);
      const native = { historyLimit: options.historyLimit, historySince: options.historySince };
      invoke("startImport", [jobId, browserId, profileId, kinds, native]).catch((error) => finish(() => reject(error)));
    });
  };

  const finishByEvent = <T,>(method: string, args: unknown[], prefix: string, success: string, read: (event: ImportEvent) => T, idleMs: number, stalled: string) => {
    const requestId = nextId(prefix);
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (run: () => void) => {
        if (settled) return;
        settled = true;
        watch.stop();
        run();
      };
      const watch = awaitEvents(
        requestId,
        (event) => {
          if (event.type === success) {
            finish(() => resolve(read(event)));
            return true;
          }
          if (event.type === "failed") {
            finish(() => reject(failure(typeof event.code === "string" ? event.code : "unreadable", typeof event.message === "string" ? event.message : stalled)));
            return true;
          }
          return false;
        },
        idleMs,
        () => finish(() => reject(failure("timeout", stalled))),
      );
      invoke(method, [requestId, ...args]).catch((error) => finish(() => reject(error)));
    });
  };

  const writePasswords = (token: string, profile: string) => {
    const requestId = nextId("write");
    return new Promise<WrittenPasswords>((resolve, reject) => {
      let settled = false;
      const finish = (run: () => void) => {
        if (settled) return;
        settled = true;
        watch.stop();
        run();
      };
      const watch = awaitEvents(
        requestId,
        (event) => {
          if (event.type === "written") {
            finish(() => resolve(writtenPasswords(event)));
            return true;
          }
          if (event.type === "failed") {
            finish(() => reject(failure(typeof event.code === "string" ? event.code : "unreadable", typeof event.message === "string" ? event.message : "Saving passwords failed")));
            return true;
          }
          return false;
        },
        IMPORT_IDLE_MS,
        () => finish(() => reject(failure("timeout", "Saving the imported passwords stopped responding"))),
      );
      invoke("writePasswords", [requestId, token, profile]).catch((error) => finish(() => reject(error)));
    });
  };

  return {
    async listBrowsers() {
      const list = await invoke<unknown>("listBrowsers", []);
      if (!Array.isArray(list)) throw failure("unreadable", "The browser list is not a list");
      const sources = list.filter((source): source is ImportApi.BrowserSource =>
        !!source && typeof source.id === "string" && typeof source.name === "string" && Array.isArray(source.profiles) && (source.family === "chromium" || source.family === "firefox"));
      families.clear();
      keychains.clear();
      for (const source of sources) {
        families.set(source.id, source.family);
        if (source.family === "chromium" && source.needsKeychain === true) keychains.add(source.id);
      }
      return sources;
    },
    importData,
    async unlockBrowser(browserId, options: UnlockOptions = {}) {
      const family = families.get(browserId);
      if (family === "chromium" && !keychains.has(browserId)) return;
      if (family !== "chromium" && family !== "firefox") throw failure("unsupported", "This browser can't be unlocked on Linux");
      const primaryPassword = family === "firefox" && typeof options.primaryPassword === "string" ? options.primaryPassword : null;
      const strings = (list: unknown) => (Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : []);
      const args = family === "firefox" ? [browserId, primaryPassword, strings(options.profiles), strings(options.kinds)] : [browserId, primaryPassword];
      const cardsLocked = await finishByEvent("unlockBrowser", args, "unlock", "unlocked", (event) => event.cardsLocked === true,
        UNLOCK_DEADLINE_MS, "The system keyring didn't answer");
      if (cardsLocked) unlocked.delete(browserId);
      else unlocked.set(browserId, now());
    },
    isBrowserUnlocked: (browserId) => stillUnlocked(browserId) || (families.get(browserId) === "chromium" && !keychains.has(browserId)),
    forgetUnlockedKeys() {
      unlocked.clear();
      void invoke("forgetUnlockedKeys", []).catch(reportHostError);
    },
    async writeImported(token, profile, kinds) {
      if (!TOKEN.test(token)) throw failure("expired", "The imported data is no longer available");
      return finishByEvent("writeImported", [token, profile, kinds.filter((k) => k === "cookies" || k === "autofill")], "write", "importedWritten",
        writtenImported, IMPORT_IDLE_MS, "Saving the imported data stopped responding");
    },
    discardImported(token) {
      if (TOKEN.test(token)) void invoke("discardImported", [token]).catch(reportHostError);
    },
    async listExtensions(browserId, profileId) {
      const list = await invoke<unknown>("listExtensions", [browserId, profileId]);
      return Array.isArray(list) ? list.filter((e) => e && typeof e.id === "string" && typeof e.name === "string" && typeof e.webStoreUrl === "string") : [];
    },
    importSafariExport: () => unsupported("Safari import"),
    safariHasFullDiskAccess: () => false,
    openFullDiskAccessSettings: () => unsupported("Full Disk Access"),
    importSafariDirect: () => unsupported("Safari import"),
    async importBookmarksHTML(path) {
      const reply = await invoke<{ root?: ImportApi.BookmarkNode }>("importBookmarksHTML", [path]);
      if (!reply?.root || reply.root.type !== "folder") throw failure("unreadable", "The bookmarks file couldn't be read");
      return reply.root;
    },
    async importPasswordsCSV(path) {
      const reply = await invoke<{ passwords?: unknown; entries?: unknown }>("importPasswordsCSV", [path]);
      const pending = pendingPasswords(reply);
      const entries = Array.isArray(reply?.entries)
        ? reply.entries.filter((e): e is { url: string; username: string } => !!e && typeof e.url === "string" && typeof e.username === "string")
        : [];
      if (!pending || !entries.length) return [];
      return issueImportHandles(pending.token, entries, (token, profile) => writePasswords(token, profile));
    },
    async chooseImportFile(kind) {
      if (kind !== "bookmarksHTML" && kind !== "passwordsCSV") return null;
      const requestId = nextId("choose");
      let chosen: string | null = null;
      const watch = awaitEvents(
        requestId,
        (event) => {
          if (event.type !== "chosen") return false;
          chosen = typeof event.path === "string" && event.path.startsWith("/") ? event.path : null;
          return true;
        },
        CHOOSER_DEADLINE_MS,
        () => void invoke("cancelChooser", [requestId]).catch(reportHostError),
      );
      try {
        await invoke("chooseImportFile", [requestId, kind]);
      } catch (error) {
        watch.stop();
        throw error;
      }
      await watch.done;
      return chosen;
    },
    readDiaTabs: () => unsupported("Dia tab import"),
    writePasswords,
    discardPasswords(token) {
      void invoke("discardPasswords", [token]).catch(reportHostError);
    },
  };
}

const WEB_PAGE = /^https?:\/\//;
const PNG_BASE64 = /^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/;

function isFavicon(value: unknown): value is ImportApi.ImportedFavicon {
  const icon = value as Partial<ImportApi.ImportedFavicon> | null;
  return !!icon && typeof icon.page === "string" && WEB_PAGE.test(icon.page) && typeof icon.icon === "string" &&
    typeof icon.png === "string" && PNG_BASE64.test(icon.png);
}

function normalizeResult(value: unknown, browserId: string, profileId: string): ImportApi.ImportResult {
  const result = (value && typeof value === "object" ? value : {}) as Partial<ImportApi.ImportResult> & Record<string, unknown>;
  const list = <T,>(item: unknown) => (Array.isArray(item) ? (item as T[]) : []);
  return {
    ...result,
    browserId: typeof result.browserId === "string" ? result.browserId : browserId,
    profileId: typeof result.profileId === "string" ? result.profileId : profileId,
    history: list(result.history),
    historyCount: count(result.historyCount),
    tabs: list(result.tabs),
    tabGroups: list(result.tabGroups),
    credentials: [],
    cookieCount: count(result.cookieCount),
    addressCount: count(result.addressCount),
    cardCount: count(result.cardCount),
    vaultToken: typeof result.vaultToken === "string" && TOKEN.test(result.vaultToken) ? result.vaultToken : undefined,
    spaces: list(result.spaces),
    favorites: list(result.favorites),
    favicons: list<ImportApi.ImportedFavicon>(result.favicons).filter(isFavicon),
    failed: list(result.failed),
    warnings: list(result.warnings),
  };
}
