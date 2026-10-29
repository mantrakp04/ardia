import { copyText } from "../../platform/clipboard";
import { fileExists, moveToTrash, openFile, revealFile } from "../../platform/files";
import { showMenu, type MenuItem } from "../../platform/menus";
import { menuSections } from "../app/menuSections";
import { openInternalPage } from "../pages/urls";
import { removeDownload } from "../windows/actions";
import { opensWhenDone, toggleOpenWhenDone } from "../windows/downloadWatch";
import { cancelDownload, keepDownload, pauseDownload, resumeDownload, type Download } from "./actions";

export const awaitsKeep = (d: Pick<Download, "state" | "dangerous">) => d.state === "downloading" && d.dangerous === true;

export type DownloadMenuState = { held: boolean; downloading: boolean; paused: boolean; opensWhenDone: boolean; fileExists: boolean };

export function downloadMenuItems(d: DownloadMenuState): MenuItem[] {
  const lead: MenuItem[] = d.held
    ? [
        { id: "keep", title: "Keep", symbol: "checkmark.circle" },
        { id: "cancel", title: "Discard", symbol: "xmark.circle" },
      ]
    : d.downloading
      ? [
          { id: "whenDone", title: "Open When Done", checked: d.opensWhenDone },
          d.paused ? { id: "resume", title: "Resume", symbol: "play" } : { id: "pause", title: "Pause", symbol: "pause" },
          { id: "cancel", title: "Cancel", symbol: "xmark.circle" },
        ]
      : [
          { id: "open", title: "Open", symbol: "arrow.up.forward.app", enabled: d.fileExists },
          { id: "reveal", title: "Show in Finder", symbol: "folder", enabled: d.fileExists },
        ];
  return menuSections(
    lead,
    [
      { id: "copy", title: "Copy Link", symbol: "link" },
      { id: "page", title: "Show All Downloads", symbol: "arrow.down.circle" },
    ],
    [
      { id: "remove", title: "Remove from List", symbol: "minus.circle", enabled: !d.downloading },
      d.fileExists && { id: "trash", title: "Move to Trash", symbol: "trash" },
    ],
  );
}

export async function downloadMenu(d: Download, windowId: string) {
  const exists = d.state === "finished" && fileExists(d.path);
  const choice = await showMenu(
    downloadMenuItems({ held: awaitsKeep(d), downloading: d.state === "downloading", paused: d.paused, opensWhenDone: opensWhenDone(d.id), fileExists: exists }),
  );
  if (choice === "whenDone") toggleOpenWhenDone(d.id);
  if (choice === "pause") void pauseDownload(d.id);
  if (choice === "resume") void resumeDownload(d.id);
  if (choice === "keep") void keepDownload(d.id);
  if (choice === "cancel") void cancelDownload(d.id);
  if (choice === "open") void openFile(d.path);
  if (choice === "reveal") void revealFile(d.path);
  if (choice === "copy") copyText(d.url);
  if (choice === "page") openInternalPage("downloads", windowId);
  if (choice === "trash") void trashDownload(d);
  if (choice === "remove") removeDownload(d.id);
}

async function trashDownload(d: Download) {
  if (await moveToTrash(d.path)) removeDownload(d.id);
}
