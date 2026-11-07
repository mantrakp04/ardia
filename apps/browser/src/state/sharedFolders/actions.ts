import { confirm, pickFolder } from "../../platform/dialogs";
import { sharePage } from "../../platform/share";
import { createSharedFolder, revealSharedFolder, sharedFoldersAvailable, sharedLocation } from "../../platform/sharedFolders";
import { useBrowser, type BrowserState } from "../browser/store";
import type { Tab } from "../browser/types";
import { IDLE_LIVE, isIncognitoProfile, makeTab, newId, pinKeyOf } from "../browser/model";
import { pinnedGroupMembers } from "../browser/structure";
import { insertAll, nestGroups, orderSections, syncGroupOrder } from "../groups/groups";
import { markPinned } from "../pins/pinChoices";
import { groupLabel } from "../pins/tabGrouping";
import { ASLEEP } from "../tabs/pageSession";
import { isRegularWindow } from "../windows/small";
import { measureRow } from "../sidebar/sidebarUi";
import { EMPTY_FOLDER_URL } from "./applyFolder";
import { syncFolderAfterNow, syncFolderNow } from "./engine";
import { bindFolder, boundFolders, folderRef, sharedFolderOf, unbindFolder, useSharedFolders } from "./store";
import { canShareGroup, sharedFolderOfGroup } from "./removal";
import { showToast } from "../app/toasts";

const store = () => useBrowser.getState();

export const fileUrlOf = (path: string) => `file://${path.split("/").map(encodeURIComponent).join("/")}/`;

async function chooseParent(windowId: string): Promise<string | null> {
  const location = sharedLocation();
  if (location.iCloudAvailable) return location.path;
  const { confirmed } = await confirm({
    title: "iCloud Drive Is Off",
    message:
      "Shared folders live in iCloud Drive, where the people you invite get your changes. Turn it on in System Settings › Apple Account › iCloud, or keep the folder in another folder that syncs, like one in Dropbox.",
    confirmTitle: "Choose Folder…",
    windowId,
  });
  return confirmed ? pickFolder(null, "Use Folder") : null;
}

export function withSharedGroup(s: BrowserState, windowId: string, name: string): [BrowserState, string] {
  const w = s.windows[windowId];
  if (!isRegularWindow(w)) return [s, ""];
  const profileId = w.profileId;
  const tab: Tab = { ...makeTab(windowId, profileId, EMPTY_FOLDER_URL, { title: "Empty Folder", customTitle: "Empty Folder" }), page: ASLEEP };
  const id = newId("g");
  const groups = nestGroups({
    ...s.groups,
    [id]: { id, windowId, profileId, name, icon: null, color: null, collapsed: false, pinned: true, tabIds: [tab.id], createdAt: Date.now() },
  });
  const tabs = { ...s.tabs, [tab.id]: tab };
  const pinnedArea = pinnedGroupMembers(s.groups);
  const ids = [...w.tabIds];
  insertAll(ids, w.tabIds.reduce((last, t, i) => (s.tabs[t]?.pin || pinnedArea.has(t) ? i + 1 : last), 0), [tab.id]);
  const window = { ...w, tabIds: orderSections(ids, tabs, groups) };
  const pinChoices = markPinned(s.pinChoices, profileId, { groups: [id], placed: [tab.id] });
  return [{ ...s, tabs, live: { ...s.live, [tab.id]: IDLE_LIVE }, pinChoices, groups: syncGroupOrder(groups, window), windows: { ...s.windows, [windowId]: window } }, id];
}

export async function addSharedFolder(windowId: string) {
  const w = store().windows[windowId];
  if (!sharedFoldersAvailable() || !isRegularWindow(w) || isIncognitoProfile(w.profileId)) return;
  const location = sharedLocation();
  const start = location.iCloudAvailable ? location.path : await chooseParent(windowId);
  if (!start) return;
  const path = await pickFolder(start, "Add Folder");
  if (!path) return;
  const profileId = store().windows[windowId]?.profileId ?? w.profileId;
  const known = boundFolders().find((b) => b.profileId === profileId && b.folder.path === path);
  if (known) {
    const g = Object.values(store().groups).find((x) => x.profileId === profileId && x.pinned && pinKeyOf(x) === known.key);
    showToast(windowId, `“${(g && groupLabel(store(), g)) || path.split("/").at(-1)}” is already in your sidebar`, undefined, { icon: "person.2" });
    return syncFolderNow(profileId, known.key);
  }
  const [next, groupId] = withSharedGroup(store(), windowId, path.split("/").filter(Boolean).at(-1) ?? "Shared Folder");
  if (!groupId) return;
  useBrowser.setState(next);
  const key = pinKeyOf(store().groups[groupId]!);
  bindFolder(profileId, key, path);
  await syncFolderNow(profileId, key);
}

export async function shareFolder(windowId: string, groupId: string) {
  const s = store();
  const g = s.groups[groupId];
  if (!g || !canShareGroup(s, groupId)) return;
  const key = pinKeyOf(g);
  try {
    let folder = sharedFolderOf(g.profileId, key);
    if (!folder) {
      const parent = await chooseParent(windowId);
      if (!parent) return;
      const path = await createSharedFolder(parent, groupLabel(s, g) || "Shared Folder");
      bindFolder(g.profileId, key, path);
    }
    await syncFolderAfterNow(g.profileId, key);
    folder = sharedFolderOf(g.profileId, key);
    if (!folder) return;
    const state = useSharedFolders.getState().sync[folderRef(g.profileId, key)]?.state;
    if (state !== "synced" && state !== "waiting") {
      const why = useSharedFolders.getState().sync[folderRef(g.profileId, key)]?.error;
      const reason = why ?? (state === "missing" ? "Its folder can’t be found any more. Stop syncing it, then share it again." : "Its links aren’t in the folder yet. Try again in a moment.");
      return showToast(windowId, "Couldn’t share this folder yet", reason, { icon: "exclamationmark.icloud" });
    }
    const anchor = await measureRow(windowId, groupId);
    await sharePage(fileUrlOf(folder.path), groupLabel(store(), g) || null, windowId, anchor ? [anchor.x, anchor.y, anchor.width, anchor.height] : null);
  } catch (error) {
    showToast(windowId, "Couldn’t share this folder", error instanceof Error ? error.message : String(error), { icon: "exclamationmark.icloud" });
  }
}

export function revealGroupFolder(groupId: string) {
  const shared = sharedFolderOfGroup(store(), groupId);
  if (shared) void revealSharedFolder(shared.folder.path);
}

export function stopSyncingGroup(groupId: string) {
  const shared = sharedFolderOfGroup(store(), groupId);
  if (shared) unbindFolder(shared.profileId, shared.key);
}
