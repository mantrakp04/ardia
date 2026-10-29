import type { ArdiaHost } from "./host";
import { hostSupports, invokeHost, reportHostError } from "./host.ts";
import { FILE_STATUS } from "./fileCapabilities.ts";

export const FILE_STATUS_FRESH_MS = 2000;
const FILE_STATUS_BATCH_MS = 16;
const FILE_STATUS_BATCH = 64;
const FILE_STATUS_CACHE = 512;
const ICON = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;

type Clock = { now(): number; schedule(run: () => void, ms: number): unknown };
type Notice = (title: string, message: string) => void;
const FAILURE_TITLES: Record<string, string> = {
  openFile: "Couldn't Open the File",
  revealFile: "Couldn't Show the File",
  moveToTrash: "Couldn't Move the File to the Trash",
};
const realClock: Clock = { now: () => Date.now(), schedule: (run, ms) => setTimeout(run, ms) };

export type HostFiles = {
  fileExists(path: string): boolean;
  expect(path: string): void;
  setNotice(notice: Notice): void;
  openFile(path: string): Promise<boolean>;
  revealFile(path: string): Promise<boolean>;
  moveToTrash(path: string): Promise<boolean>;
  fileIcon(path: string, size: number): Promise<string | null>;
  appIcon(pid: number, size: number): Promise<string | null>;
  onChange(listener: () => void): () => void;
};

const localPath = (path: unknown): path is string => typeof path === "string" && path.startsWith("/") && path.length <= 4096 && !path.includes("\0");

export function createHostFiles(host: ArdiaHost, clock: Clock = realClock, notice: Notice = () => {}): HostFiles {
  let currentNotice = notice;
  const cache = new Map<string, { exists: boolean; at: number }>();
  const queued = new Set<string>();
  const inflight = new Set<string>();
  const listeners = new Set<() => void>();
  let scheduled = false;

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const remember = (path: string, exists: boolean) => {
    const previous = cache.get(path);
    cache.delete(path);
    cache.set(path, { exists, at: clock.now() });
    while (cache.size > FILE_STATUS_CACHE) cache.delete(cache.keys().next().value!);
    return (previous?.exists ?? false) !== exists;
  };
  const flush = () => {
    scheduled = false;
    const paths = [...queued].slice(0, FILE_STATUS_BATCH);
    for (const path of paths) {
      queued.delete(path);
      inflight.add(path);
    }
    if (queued.size) schedule();
    if (!paths.length) return;
    void invokeHost<unknown>(FILE_STATUS, { args: [paths] }, host)
      .then((reply) => {
        if (!Array.isArray(reply) || reply.length !== paths.length) throw Object.assign(new Error("Invalid file status reply"), { code: "ERR_BAD_REPLY" });
        let changed = false;
        paths.forEach((path, index) => (changed = remember(path, reply[index] === true) || changed));
        if (changed) notify();
      })
      .catch((error) => {
        for (const path of paths) remember(path, cache.get(path)?.exists ?? false);
        reportHostError(error);
      })
      .finally(() => {
        for (const path of paths) inflight.delete(path);
      });
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    clock.schedule(flush, FILE_STATUS_BATCH_MS);
  };
  const action = (method: string, path: string) =>
    localPath(path)
      ? invokeHost<unknown>(`ArdiaSystem.${method}`, { args: [path] }, host).then((reply) => reply === true, (error) => {
          reportHostError(error);
          const message = error instanceof Error && error.message ? error.message : "The desktop did not respond";
          currentNotice(FAILURE_TITLES[method] ?? "Couldn't Use the File", message);
          return false;
        })
      : Promise.resolve(false);

  return {
    fileExists(path) {
      if (!localPath(path) || !hostSupports(FILE_STATUS, host)) return false;
      const entry = cache.get(path);
      if ((!entry || clock.now() - entry.at > FILE_STATUS_FRESH_MS) && !inflight.has(path)) {
        queued.add(path);
        schedule();
      }
      return entry?.exists ?? false;
    },
    setNotice(next) {
      currentNotice = next;
    },
    expect(path) {
      if (!localPath(path) || !hostSupports(FILE_STATUS, host) || cache.get(path)?.exists) return;
      cache.delete(path);
      cache.set(path, { exists: true, at: -Infinity });
      while (cache.size > FILE_STATUS_CACHE) cache.delete(cache.keys().next().value!);
      if (!inflight.has(path)) {
        queued.add(path);
        schedule();
      }
    },
    openFile: (path) => action("openFile", path),
    revealFile: (path) => action("revealFile", path),
    async moveToTrash(path) {
      const trashed = await action("moveToTrash", path);
      if (trashed && remember(path, false)) notify();
      return trashed;
    },
    fileIcon(path, size) {
      if (typeof path !== "string" || !path || path.length > 4096 || path.includes("\0") || !Number.isFinite(size)) return Promise.resolve(null);
      return invokeHost<unknown>("ArdiaSystem.fileIcon", { args: [path, size] }, host).then(
        (reply) => (typeof reply === "string" && ICON.test(reply) ? reply : null),
        () => null,
      );
    },
    appIcon: async () => null,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const perHost = new WeakMap<ArdiaHost, HostFiles>();

export function hostFiles(host: ArdiaHost): HostFiles {
  let files = perHost.get(host);
  if (!files) perHost.set(host, (files = createHostFiles(host)));
  return files;
}

const SYSTEM_METHODS = new Set(["fileExists", "openFile", "revealFile", "moveToTrash", "fileIcon", "appIcon"]);

export function linuxSystemMethod(host: ArdiaHost, method: string): unknown {
  if (!SYSTEM_METHODS.has(method)) return undefined;
  const files = hostFiles(host);
  return files[method as keyof HostFiles];
}
