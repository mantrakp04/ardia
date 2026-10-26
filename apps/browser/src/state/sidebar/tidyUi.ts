import { useBrowser } from "../browser/store";
import { plural } from "../browser/model";
import { tidying, untidying, type Tidied, type TidyScope } from "../pins/tidy";
import { showToast } from "../app/toasts";

export function tidy(windowId: string, scope: TidyScope, profileId?: string) {
  let tidied: Tidied | null = null;
  useBrowser.setState((s) => {
    const [next, done] = tidying(s, windowId, profileId, scope);
    tidied = done;
    return next;
  });
  const done = tidied as Tidied | null;
  if (!done) return;
  const duplicates = done.duplicates ? `Closed ${plural(done.duplicates, done.moved ? "duplicate" : "Duplicate Pin")}` : "";
  const moved = scope === "pins" ? `Tidied ${plural(done.moved, "Pin")} into ${plural(done.groups, "Folder")}` : `Tidied ${plural(done.moved, "Tab")} into ${plural(done.groups, "Group")}`;
  const title = done.moved ? moved : duplicates;
  showToast(windowId, title, done.moved && duplicates ? duplicates : undefined, {
    icon: "sparkles",
    action: { title: "Undo", run: () => useBrowser.setState((s) => untidying(s, done)) },
  });
}
