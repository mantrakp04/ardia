import type { Download } from "../../../packages/ardiacore/src/downloads";
import type { ArdiaHost } from "./host";
import { callHost, reportHostError } from "./host.ts";
import { hostFiles } from "./hostFiles.ts";
import { showToast } from "../../browser/src/state/app/toasts";

const DOWNLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES = new Set(["downloading", "finished", "failed", "cancelled"]);
export const DOWNLOAD_LIMIT = 100;

export const nativeDownloadId = (id: unknown): id is string => typeof id === "string" && DOWNLOAD_ID.test(id);

const text = (value: unknown) => typeof value === "string";
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value);

export function snapshotDownload(value: unknown, offTheRecord = false): Download | null {
  if (!value || typeof value !== "object") return null;
  const d = value as Record<string, unknown>;
  if (!nativeDownloadId(d.id) || !STATES.has(d.state as string) || (d.offTheRecord === true) !== offTheRecord) return null;
  if (![d.url, d.filename, d.path, d.mimeType].every(text) || typeof d.paused !== "boolean") return null;
  if (![d.received, d.total, d.speed].every(count)) return null;
  return { ...(d as Download), profile: "" };
}

const SNAPSHOT_PROFILE = "\u0000snapshot";

export function planDownloadSnapshot(current: Download[], snapshot: unknown, excluded: ReadonlySet<string> = new Set(), limit = DOWNLOAD_LIMIT, offTheRecord = false) {
  if (!Array.isArray(snapshot)) return { downloads: null, added: [] as Download[] };
  const known = new Set(current.map((d) => d.id));
  const seen = new Set<string>();
  const listed: Download[] = [];
  for (const entry of snapshot) {
    const d = snapshotDownload(entry, offTheRecord);
    if (!d || seen.has(d.id) || excluded.has(d.id)) continue;
    seen.add(d.id);
    listed.push(d);
  }
  const merged = [...current, ...listed.filter((d) => !known.has(d.id))].slice(0, limit);
  const added = merged.slice(current.length);
  return { downloads: added.length ? merged : null, added };
}

export const mergeDownloadSnapshot = (current: Download[], snapshot: unknown, limit = DOWNLOAD_LIMIT) =>
  planDownloadSnapshot(current, snapshot, new Set(), limit).downloads;

type DownloadState = {
  downloads: Download[];
  removeDownload(id: string): void;
  clearDownloads(windowId?: string): void;
};

export type DownloadStore = {
  getState(): DownloadState;
  setState(patch: Partial<DownloadState>): void;
};

const removable = (d: Download) => nativeDownloadId(d.id) && d.state !== "downloading";

const privateOriginal = (pageProfile: string) =>
  pageProfile.startsWith("incognito:") && pageProfile.includes("@") ? pageProfile.slice(pageProfile.indexOf("@") + 1) : null;

export function startHostDownloads(host: ArdiaHost, store: DownloadStore) {
  const { removeDownload, clearDownloads } = store.getState();
  const pageProfile = host.bootstrap.pageProfile ?? "";
  const original = privateOriginal(pageProfile);
  const listedProfile = original ?? pageProfile;
  const call = (verb: string, args: object) => callHost(`downloads.${verb}`, "", JSON.stringify(args), host);
  const kept = () => store.getState().downloads.map((d) => d.id).filter(nativeDownloadId).slice(0, DOWNLOAD_LIMIT);
  const clearNative = () => void call("clear", { keep: kept(), before: Date.now() }).catch(reportHostError);
  let listing = true;
  const removedWhileListing = new Set<string>();
  const removedLocally = (gone: Download[]) => {
    if (listing) for (const d of gone) removedWhileListing.add(d.id);
  };
  store.setState({
    removeDownload(id) {
      const gone = store.getState().downloads.filter((d) => d.id === id);
      removeDownload(id);
      removedLocally(gone);
      for (const d of gone.filter(removable)) void call("remove", { id: d.id }).catch(reportHostError);
    },
    clearDownloads(windowId) {
      const before = store.getState().downloads;
      clearDownloads(windowId);
      const remaining = new Set(store.getState().downloads.map((d) => d.id));
      removedLocally(before.filter((d) => !remaining.has(d.id)));
      clearNative();
    },
  });
  const files = hostFiles(host);
  files.setNotice((title, message) => showToast(host.bootstrap.windowId, title, message));
  const expectFinished = (d: { state?: unknown; path?: unknown } | null | undefined) => {
    if (d?.state === "finished" && typeof d.path === "string") files.expect(d.path);
  };
  for (const d of store.getState().downloads) expectFinished(d);
  const stop = host.onEvent((module, event, payload) => {
    if (module !== "ArdiaDownloads" || event !== "downloads" || !payload || typeof payload !== "object") return;
    const { name, data } = payload as { name?: unknown; data?: { id?: unknown; state?: unknown; path?: unknown } | null };
    if (name === "downloads.changed") return expectFinished(data);
    const id = data?.id;
    if (name !== "downloads.removed" || !nativeDownloadId(id)) return;
    if (listing) removedWhileListing.add(id);
    if (store.getState().downloads.some((d) => d.id === id)) removeDownload(id);
  });
  const stopFiles = files.onChange(() => store.setState({ downloads: [...store.getState().downloads] }));
  const ready = call("list", {})
    .then((reply) => {
      const plan = planDownloadSnapshot(store.getState().downloads, JSON.parse(reply), removedWhileListing, DOWNLOAD_LIMIT, original !== null);
      if (plan.downloads) {
        for (const d of plan.added) expectFinished(d);
        const fresh = new Set(plan.added.map((d) => d.id));
        store.setState({ downloads: plan.downloads.map((d) => (fresh.has(d.id) ? { ...d, profile: SNAPSHOT_PROFILE } : d)) });
        store.setState({ downloads: plan.downloads.map((d) => (fresh.has(d.id) ? { ...d, profile: listedProfile } : d)) });
      }
    })
    .catch(reportHostError)
    .finally(() => {
      listing = false;
      removedWhileListing.clear();
    });
  return {
    ready,
    stop() {
      stop();
      stopFiles();
      store.setState({ removeDownload, clearDownloads });
    },
  };
}
