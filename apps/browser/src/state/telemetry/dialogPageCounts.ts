import { dialogPages } from "../../platform/dialogPages";

export function takeDialogPageCounts() {
  const { asked, stalled } = dialogPages.takeDialogPages();
  return { dialog_pages_asked: asked, dialog_pages_stalled: stalled };
}
