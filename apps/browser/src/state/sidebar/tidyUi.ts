import { useBrowser } from "../browser/store";
import { plural } from "../browser/model";
import { canUndoTidy, pinStatesOf, tidying, untidying, type Tidied, type TidyScope } from "../pins/tidy";
import { noteTidyTabsRun, noteTidyTabsUndo } from "../telemetry/tidyTabsCounts";
import { showUndoToast } from "./undoToast";

export function tidy(windowId: string, scope: TidyScope, profileId?: string) {
  let tidied: Tidied | null = null;
  useBrowser.setState((s) => {
    const [next, done] = tidying(s, windowId, profileId, scope);
    tidied = done;
    return next;
  });
  const done = tidied as Tidied | null;
  if (!done) return;
  if (scope === "tabs") noteTidyTabsRun(done.moved);
  const duplicates = done.duplicates ? `Closed ${plural(done.duplicates, done.moved ? "duplicate" : "Duplicate Pin")}` : "";
  const moved = scope === "pins" ? `Tidied ${plural(done.moved, "Pin")} into ${plural(done.groups, "Folder")}` : `Tidied ${plural(done.moved, "Tab")} into ${plural(done.groups, "Group")}`;
  const pinsAfter = pinStatesOf(useBrowser.getState(), done);
  showUndoToast(windowId, done.moved ? moved : duplicates, "sparkles", {
    message: done.moved && duplicates ? duplicates : undefined,
    undo: () => {
      useBrowser.setState((s) => untidying(s, done));
      if (scope === "tabs") noteTidyTabsUndo();
    },
    watched: (s) => [s.tabs],
    canUndo: (s) => canUndoTidy(s, pinsAfter),
  });
}
