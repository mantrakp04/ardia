import { showMenu } from "@ardia/shell";
import { useBrowser } from "../../store/browser";
import { activeTabId } from "../../store/model";
import { clickTab } from "../sidebar/actions";
import { folderMenuItems } from "./stripGroups";

export async function openFolderMenu(windowId: string, groupId: string) {
  const s = useBrowser.getState();
  const choice = await showMenu(folderMenuItems(s, groupId, activeTabId(s, windowId)));
  if (choice?.startsWith("t:") && useBrowser.getState().tabs[choice.slice(2)]) clickTab(windowId, choice.slice(2));
}
