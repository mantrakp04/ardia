import { useBrowser, type BrowserState } from "../browser/store";
import { pinKeyOf } from "../browser/model";
import { fromSync } from "../pins/pinOrderChoices";
import { sessionSaved } from "../session/persist";
import { saveBeforeQuit } from "../app/quit";
import { guardGroupClose, keepGroupsOpen } from "../groups/closeGuard";
import { confirmRemovingShared, sharedFolderOfGroup } from "./removal";
import { isRegularWindow } from "../windows/small";
import { onSharedFolderChange, readSharedFolder, sharedFoldersAvailable, watchSharedFolders, writeSharedFolder } from "../../platform/sharedFolders";
import { APPLIED_FIELDS, withFolder } from "./applyFolder";
import { knownNames, localFolder, signatureOf } from "./local";
import { mergeFolder } from "./merge";
import { planFiles } from "./plan";
import { remoteLevel } from "./remote";
import { boundFolders, folderRef, saveFoldersNow, setFolderBase, setFolderSync, sharedFolderOf, unbindFolder, useSharedFolders } from "./store";

type Place = { kind: "shown"; groupId: string } | { kind: "hidden" } | { kind: "gone" };

const LOCAL_SETTLE_MS = 300;
const REMOTE_SETTLE_MS = 150;
const POLL_MS = 60_000;
const CONFLICT_RETRY_MS = 3000;

const store = () => useBrowser.getState();

export function folderPlace(s: BrowserState, profileId: string, key: string): Place {
  if (!s.profiles[profileId]) return { kind: "gone" };
  const order = [...s.ui.focusOrder, ...s.windowOrder];
  const rank = (windowId: string) => {
    const i = order.indexOf(windowId);
    return i < 0 ? order.length : i;
  };
  const copies = Object.values(s.groups)
    .filter((g) => g.pinned && !g.parentId && g.profileId === profileId && pinKeyOf(g) === key && isRegularWindow(s.windows[g.windowId]))
    .sort((a, z) => rank(a.windowId) - rank(z.windowId));
  if (copies[0]) return { kind: "shown", groupId: copies[0].id };
  if (s.parkedPins[profileId]?.groups.some((g) => g.id === key)) return { kind: "hidden" };
  const shows = Object.values(s.windows).some((w) => isRegularWindow(w) && w.tabIds.some((id) => s.tabs[id]?.profileId === profileId));
  return shows ? { kind: "gone" } : { kind: "hidden" };
}

const signatures = new Map<string, string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Map<string, Promise<void>>();
const queued = new Set<string>();

function schedule(profileId: string, key: string, delay: number) {
  const ref = folderRef(profileId, key);
  clearTimeout(timers.get(ref));
  const fire = () => {
    timers.delete(ref);
    void syncFolderNow(profileId, key);
  };
  timers.set(ref, setTimeout(fire, delay));
}

export async function syncFolderAfterNow(profileId: string, key: string): Promise<void> {
  await running.get(folderRef(profileId, key));
  await syncFolderNow(profileId, key);
}

export function syncFolderNow(profileId: string, key: string): Promise<void> {
  const ref = folderRef(profileId, key);
  const busy = running.get(ref);
  if (busy) {
    queued.add(ref);
    return busy;
  }
  const bound = sharedFolderOf(profileId, key);
  const run = round(profileId, key)
    .catch((error: unknown) => {
      if (sharedFolderOf(profileId, key) !== bound) return void queued.add(ref);
      setFolderSync(profileId, key, { state: "error", error: error instanceof Error ? error.message : String(error) });
    })
    .finally(() => {
      running.delete(ref);
      if (queued.delete(ref)) schedule(profileId, key, REMOTE_SETTLE_MS);
    });
  running.set(ref, run);
  return run;
}

async function round(profileId: string, key: string) {
  const ref = folderRef(profileId, key);
  const folder = sharedFolderOf(profileId, key);
  if (!folder) return;
  const place = folderPlace(store(), profileId, key);
  if (place.kind !== "shown") {
    signatures.set(ref, place.kind);
    if (place.kind === "gone") unbindFolder(profileId, key);
    else setFolderSync(profileId, key, { state: "paused" });
    return;
  }
  const listing = await readSharedFolder(folder.path);
  const stale = () => sharedFolderOf(profileId, key) !== folder;
  if (stale()) return void queued.add(ref);
  if (!listing.exists) {
    if (listing.error) return setFolderSync(profileId, key, { state: "error", error: listing.error });
    signatures.set(ref, signatureOf(localFolder(store(), place.groupId, knownNames(folder.base))));
    return setFolderSync(profileId, key, { state: "missing", error: null });
  }
  const remote = remoteLevel(listing.root);
  const s = store();
  const here = folderPlace(s, profileId, key);
  if (here.kind !== "shown") return void queued.add(ref);
  const local = localFolder(s, here.groupId, knownNames(folder.base));
  if (!local) return;
  const { level, waiting } = mergeFolder(folder.base, local.entries, remote);
  const next = withFolder(s, here.groupId, level, local);
  if (next !== s) fromSync(() => useBrowser.setState(Object.fromEntries(APPLIED_FIELDS.map((f) => [f, next[f]]))));
  const { ops, base } = planFiles(level, folder.base);
  const settled = signatureOf(localFolder(store(), here.groupId, knownNames(base)));
  if (!(await sessionSaved())) {
    schedule(profileId, key, CONFLICT_RETRY_MS);
    return setFolderSync(profileId, key, { state: "syncing", error: null });
  }
  if (stale()) return void queued.add(ref);
  const { conflicts } = ops.length ? await writeSharedFolder(folder.path, ops) : { conflicts: [] };
  if (stale()) return void queued.add(ref);
  if (conflicts.length) {
    schedule(profileId, key, CONFLICT_RETRY_MS);
    return setFolderSync(profileId, key, { state: "syncing", error: null });
  }
  setFolderBase(profileId, key, base);
  signatures.set(ref, settled);
  checkLocal();
  setFolderSync(profileId, key, { state: waiting ? "waiting" : "synced", waiting, error: null });
}

function checkLocal() {
  const s = store();
  for (const { profileId, key, folder } of boundFolders()) {
    const place = folderPlace(s, profileId, key);
    const signature = place.kind === "shown" ? signatureOf(localFolder(s, place.groupId, knownNames(folder.base))) : place.kind;
    if (signature !== signatures.get(folderRef(profileId, key))) schedule(profileId, key, LOCAL_SETTLE_MS);
  }
}

const boundPaths = () => [...new Set(boundFolders().map((b) => b.folder.path))].sort();

let watched = "";
function watchBound() {
  const paths = boundPaths();
  if (paths.join("\n") === watched) return;
  watched = paths.join("\n");
  watchSharedFolders(paths);
}

export const syncAllFolders = () => boundFolders().forEach(({ profileId, key }) => schedule(profileId, key, 0));

let checkTimer: ReturnType<typeof setTimeout> | undefined;

export function startSharedFolders() {
  if (!sharedFoldersAvailable()) return;
  guardGroupClose(confirmRemovingShared);
  keepGroupsOpen((groupId) => !!sharedFolderOfGroup(store(), groupId));
  saveBeforeQuit(saveFoldersNow);
  watchBound();
  useSharedFolders.subscribe((s, prev) => {
    if (s.folders !== prev.folders) watchBound();
  });
  onSharedFolderChange((paths) => {
    for (const { profileId, key, folder } of boundFolders()) if (paths.includes(folder.path)) schedule(profileId, key, REMOTE_SETTLE_MS);
  });
  useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs && s.groups === prev.groups && s.windows === prev.windows && s.ui.focusOrder === prev.ui.focusOrder) return;
    if (!boundFolders().length) return;
    clearTimeout(checkTimer);
    checkTimer = setTimeout(checkLocal, LOCAL_SETTLE_MS);
  });
  setInterval(syncAllFolders, POLL_MS);
  syncAllFolders();
}
