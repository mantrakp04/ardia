import { cleanUrl, markdownLink } from "@ardia/core";
import { copyText } from "../../platform/clipboard";
import { prompt } from "../../platform/dialogs";
import { updateFolder } from "../live/store";
import { useBrowser } from "../browser/store";
import { webviews } from "../../platform/webviews";
import { focusHeroBar } from "../omnibox/barState";
import { ancestorIds } from "../groups/groups";
import { activeTabId, bookmarkProfileId, inPinnedContainer, pinSection, tabLayoutOf, viewTabIds } from "../browser/model";
import type { ClickMods } from "../drag/drops";
import { groupLabel, groupOf, selectedTabIds } from "../pins/organize";
import type { Tab } from "../browser/types";
import { measureRow, setSidebarUi, sidebarUi, type Target } from "./sidebarUi";

const store = () => useBrowser.getState();

export function clickTab(windowId: string, tabId: string, mods: ClickMods = {}) {
  store().clickTab(windowId, tabId, mods);
}

export function returnFocusToPage(windowId: string) {
  const s = store();
  const active = activeTabId(s, windowId);
  if (!active) return;
  if (s.tabs[active]?.url) void webviews.get(active)?.focus();
  else focusHeroBar(windowId, active);
}

export function toggleBookmarkInWindow(windowId: string, page: { url: string; title: string; favicon: string | null }) {
  const s = store();
  s.toggleBookmark(bookmarkProfileId(s, s.windows[windowId]), page);
}

export function returnShownTabToPinnedUrl(windowId: string, tabId: string) {
  const s = store();
  if (activeTabId(s, windowId) === tabId) s.returnToPinnedUrl(tabId);
}

export async function startRename(windowId: string, target: Target) {
  const s = store();
  if (target.kind === "tab") {
    const tab = s.tabs[target.id];
    if (!tab) return;
    if (tab.pinned && !tab.pinnedAsRow) {
      const name = await prompt({
        title: "Rename Tab",
        value: tab.customTitle ?? tab.title,
        placeholder: tab.title || "Tab name",
        confirmTitle: "Update",
        windowId,
      });
      if (name !== null) store().updateTab(tab.id, { customTitle: name });
      return;
    }
    const group = groupOf(s, tab.id);
    if (group && activeTabId(s, windowId) !== tab.id) {
      for (const id of [group.id, ...ancestorIds(s.groups, group.id)]) if (s.groups[id]!.collapsed) s.updateGroup(id, { collapsed: false });
    }
  }
  if (target.kind === "group" && !sidebarShows(windowId)) return renameGroupInSheet(windowId, target.id);
  setSidebarUi({ renaming: { windowId, ...target } });
}

const sidebarShows = (windowId: string) => tabLayoutOf(store(), windowId) === "sidebar" && !!store().windows[windowId]?.sidebarOpen;

async function renameGroupInSheet(windowId: string, groupId: string) {
  const g = store().groups[groupId];
  if (!g) return;
  const name = await prompt({
    title: "Rename Group",
    value: g.name,
    placeholder: groupLabel(store(), g),
    confirmTitle: "Update",
    windowId,
  });
  if (name !== null && store().groups[groupId]) store().updateGroup(groupId, { name: name.trim() });
}

export function commitRename(target: Target, text: string) {
  const name = text.trim();
  if (target.kind === "tab") {
    const tab = store().tabs[target.id];
    if (tab) store().updateTab(tab.id, { customTitle: name && name !== tab.title ? name : null });
  } else store().updateGroup(target.id, { name });
  endRename(target);
}

export function endRename(target: Target) {
  const r = sidebarUi().renaming;
  if (r && r.id === target.id) setSidebarUi({ renaming: null });
}

export async function openIconPicker(windowId: string, target: Target) {
  const anchor = await measureRow(windowId, target.id);
  setSidebarUi({ iconPicker: { windowId, ...target, anchor }, hover: null });
}

export function setIcon(target: Target, icon: string | null) {
  if (target.kind === "tab") store().updateTab(target.id, { customIcon: icon });
  else if (target.kind === "live") updateFolder(target.id.split("|")[1] ?? "", { icon });
  else store().updateGroup(target.id, { icon });
}

export function newGroupWithSelection(windowId: string, ids = selectedTabIds(store(), windowId)) {
  const groupId = store().groupTabs(ids.filter((id) => pinSection(store().tabs[id]) !== "tile"));
  if (groupId && sidebarShows(windowId)) void startRename(windowId, { kind: "group", id: groupId });
  return groupId;
}

const urlLabel = (url: string) => url.replace(/^[a-z][\w+.-]*:\/\//i, "").replace(/^www\./, "").replace(/\/$/, "");
export const tabTitle = (t: Pick<Tab, "customTitle" | "title" | "url">) => t.customTitle || t.title || (t.url && urlLabel(t.url)) || "New Tab";

export function copyUrls(ids: string[], markdown: boolean) {
  const tabs = ids.map((id) => store().tabs[id]).filter((t): t is Tab => !!t?.url);
  if (!tabs.length) return;
  const lines = tabs.map((t) => (markdown ? markdownLink(tabTitle(t), t.url) : cleanUrl(t.url)));
  copyText(markdown && lines.length > 1 ? lines.map((l) => `- ${l}`).join("\n") : lines.join("\n"));
}

export async function bookmarkTabs(windowId: string, ids: string[], folder: string | "bar" | "new") {
  const s = store();
  const profileId = bookmarkProfileId(s, s.windows[windowId]);
  let parentId: string | undefined = folder === "bar" ? undefined : folder;
  if (folder === "new") {
    const title = await prompt({ title: "New Folder", placeholder: "Folder name", confirmTitle: "Create", windowId });
    if (!title) return;
    parentId = store().addBookmarkFolder({ profileId, title });
  }
  for (const id of ids) {
    const t = store().tabs[id];
    if (t?.url) store().addBookmark({ profileId, url: t.url, title: tabTitle(t), favicon: t.favicon, parentId });
  }
}

export async function editPinnedPage(windowId: string, tabId: string) {
  const tab = store().tabs[tabId];
  if (!tab || !inPinnedContainer(store(), tabId)) return;
  const url = await prompt({
    title: "Edit Pinned Page",
    value: tab.pinnedUrl ?? tab.url,
    placeholder: "Enter Pinned URL",
    confirmTitle: "Save",
    windowId,
  });
  if (url) store().setPinnedUrl(tabId, url.includes("://") ? url : `https://${url}`);
}

export function muteAll(windowId: string, muted: boolean) {
  store().setMuted(viewTabIds(store(), windowId), muted);
}

export const allMuted = (windowId: string) => {
  const s = store();
  const view = viewTabIds(s, windowId).filter((id) => s.tabs[id]!.url);
  return view.length > 0 && view.every((id) => s.tabs[id]!.muted);
};
