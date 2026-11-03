import { onDownload, type Download } from "../../platform/downloads";
import { useBrowser } from "../browser/store";
import { decideDownload } from "./decisions";
import { activeHook, onHooksChanged, useHookRules } from "./hookRules";
import { isInsideDownloads } from "./hookPolicy";

export type MoveResult = { ok: true; path: string } | { ok: false; reason: string };
export type DownloadMover = {
  move(path: string, folder: string): Promise<MoveResult>;
  approveFolders(folders: string[]): void;
};

let mover: DownloadMover | null = null;
const handled = new Set<string>();
const HANDLED_CAP = 500;

export function approvedDownloadFolders(): string[] {
  const folders = useHookRules
    .getState()
    .hooks.filter((h) => h.rules?.folder && !isInsideDownloads(h.rules.folder) && activeHook(h))
    .map((h) => h.rules!.folder!);
  return [...new Set(folders)].sort();
}

let lastApproved: string | null = null;

function pushApprovedFolders() {
  if (!mover) return;
  const folders = approvedDownloadFolders();
  const key = folders.join("\n");
  if (key === lastApproved) return;
  lastApproved = key;
  try {
    mover.approveFolders(folders);
  } catch (error) {
    console.warn("[automation] couldn't pass the approved download folders on", error);
  }
}

function remember(id: string) {
  handled.add(id);
  if (handled.size > HANDLED_CAP) handled.delete(handled.values().next().value!);
}

export async function settleFinishedDownload(d: Download): Promise<MoveResult | null> {
  if (!mover || handled.has(d.id) || d.state !== "finished" || !d.path || d.offTheRecord || d.dangerous) return null;
  remember(d.id);
  const verdict = decideDownload(
    { url: d.url, filename: d.filename, mimeType: d.mimeType, size: d.total || d.received, path: d.path, profile: d.profile ?? null },
    approvedDownloadFolders(),
  );
  const folder = verdict instanceof Promise ? await verdict.catch(() => null) : verdict;
  if (!folder) return null;
  let result: MoveResult;
  try {
    result = await mover.move(d.path, folder);
  } catch (error) {
    result = { ok: false, reason: String(error) };
  }
  if (!result.ok) {
    console.warn(`[automation] download ${d.filename} stays where it is: ${result.reason}`);
    return result;
  }
  const current = useBrowser.getState().downloads.find((x) => x.id === d.id);
  if (current) useBrowser.getState().upsertDownload({ ...current, path: result.path, filename: result.path.split("/").pop() || current.filename });
  return result;
}

let started = false;
const inProgress = new Set<string>();
const IN_PROGRESS_CAP = 500;

export function noteDownloadEvent(d: Download) {
  if (d.state === "downloading") {
    inProgress.add(d.id);
    if (inProgress.size > IN_PROGRESS_CAP) inProgress.delete(inProgress.values().next().value!);
    return;
  }
  if (!inProgress.delete(d.id)) return;
  if (d.state === "finished") void settleFinishedDownload(d);
}

export function startDownloadHooks(next: DownloadMover) {
  mover = next;
  pushApprovedFolders();
  if (started) return;
  started = true;
  onHooksChanged(pushApprovedFolders);
  onDownload(noteDownloadEvent);
}

export function resetDownloadHooksForTests() {
  mover = null;
  handled.clear();
  inProgress.clear();
  lastApproved = null;
}
