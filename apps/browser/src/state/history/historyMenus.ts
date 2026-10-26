import { cleanUrl } from "@ardia/core";
import { confirm } from "../../platform/dialogs";
import { copyText } from "../../platform/clipboard";
import { showMenu } from "../../platform/menus";
import { openUrl } from "../bookmarks/actions";

export async function confirmRemoveSelected(windowId: string): Promise<boolean> {
  const { confirmed } = await confirm({
    title: "Remove selected items?",
    message: "Are you sure you want to delete these pages from your history?",
    confirmTitle: "Remove",
    destructive: true,
    windowId,
  });
  return confirmed;
}

export async function openHistoryRowMenu(url: string, windowId: string, onMoreFromSite: (url: string) => void, onRemove: (url: string) => void) {
  const choice = await showMenu([
    { id: "tab", title: "Open in New Tab" },
    { id: "window", title: "Open in New Window" },
    { id: "incognito", title: "Open in Incognito Window" },
    { separator: true },
    { id: "copy", title: "Copy Link" },
    { id: "more", title: "More from This Site" },
    { separator: true },
    { id: "remove", title: "Remove from History" },
  ]);
  if (choice === "tab") openUrl(url, windowId, "foreground");
  if (choice === "window") openUrl(url, windowId, "window");
  if (choice === "incognito") openUrl(url, windowId, "incognito");
  if (choice === "copy") copyText(cleanUrl(url));
  if (choice === "more") onMoreFromSite(url);
  if (choice === "remove") onRemove(url);
}
