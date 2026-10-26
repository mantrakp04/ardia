import { useBrowser } from "../browser/store";
import { plural } from "../browser/model";
import { tidyingPins, untidyingPins, type TidiedPins } from "../pins/tidyPins";
import { showToast } from "../splits/actions";

export function tidyPins(windowId: string, profileId?: string) {
  let tidied: TidiedPins | null = null;
  useBrowser.setState((s) => {
    const [next, done] = tidyingPins(s, windowId, profileId);
    tidied = done;
    return next;
  });
  const done = tidied as TidiedPins | null;
  if (!done) return;
  const duplicates = done.duplicates ? `Closed ${plural(done.duplicates, done.pins ? "duplicate" : "Duplicate Pin")}` : "";
  const title = done.pins ? `Tidied ${plural(done.pins, "Pin")} into ${plural(done.folders, "Folder")}` : duplicates;
  showToast(windowId, title, done.pins && duplicates ? duplicates : undefined, {
    icon: "sparkles",
    action: { title: "Undo", run: () => useBrowser.setState((s) => untidyingPins(s, done)) },
  });
}
