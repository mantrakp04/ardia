import { applySafari, emptyCounts, importBookmarks } from "../../state/import/apply";
import type { ImportApi, ImportCore } from "./importActions";
import type { ImportKind } from "./model";
import type { ImportState } from "./useImportState";

export function fileImports(s: ImportState, api: ImportApi | null, core: ImportCore) {
  const { target, safariCookies } = s;

  const importSafari = async (path: string) => {
    if (!api) return;
    s.setError(null);
    s.setStatus({ bookmarks: "active", history: "active", passwords: "active", autofill: "active" });
    s.setPreparing(1);
    s.setStep("progress");
    try {
      const data = await api.importSafariExport(path);
      const failed: ImportKind[] = [];
      const c = await applySafari(target, data, false, (k) => failed.push(k));
      s.setStatus({ bookmarks: "done", history: "done", passwords: "done", autofill: failed.includes("autofill") ? "failed" : "done" });
      s.setCounts(c);
      s.setFailures(failed.map((kind) => ({ kind, profiles: [] })));
      core.finish();
    } catch (e) {
      s.setStep("safari");
      s.setError((e as { code?: string }).code === "unsupported" ? "Please select a folder or zip file." : "The selected file is invalid. Please try again.");
    }
  };

  const importSafariDirect = async () => {
    if (!api) return;
    s.setError(null);
    s.setStatus({ bookmarks: "active", history: "active", tabs: "active", ...(safariCookies ? { cookies: "active" as const } : {}) });
    s.setPreparing(1);
    s.setStep("progress");
    s.abort.current = new AbortController();
    try {
      const data = await api.importSafariDirect({ signal: s.abort.current.signal });
      const failed: ImportKind[] = [];
      const c = await applySafari(target, data, safariCookies, (k) => failed.push(k));
      s.setStatus({ bookmarks: "done", history: "done", tabs: "done", ...(safariCookies ? { cookies: failed.includes("cookies") ? "failed" : ("done" as const) } : {}) });
      s.setCounts(c);
      s.setFailures(failed.map((kind) => ({ kind, profiles: [] })));
      core.finish();
    } catch (e) {
      if ((e as { code?: string }).code === "cancelled") return;
      s.setStep("safari");
      s.setError(
        (e as { code?: string }).code === "locked"
          ? "Ardia still doesn't have Full Disk Access. Grant it above, or use the export file below."
          : "Couldn't read Safari's data. Try the export file below.",
      );
      s.setFullDiskAccess(api.safariHasFullDiskAccess());
    }
  };

  const importHtml = async () => {
    if (!api) return;
    const path = await api.chooseImportFile("bookmarksHTML");
    if (!path) return;
    try {
      const root = await api.importBookmarksHTML(path);
      const n = importBookmarks(target, root, "HTML File");
      s.setCounts({ ...emptyCounts(), bookmarks: n });
      s.setFailures([]);
      s.setStatus({ bookmarks: "done" });
      s.setSource(null);
      s.setStep("done");
    } catch {
      s.setError("The selected file is invalid. Please try again.");
    }
  };

  const chooseSafariExport = async () => (await api?.chooseImportFile("safariExport")) ?? null;

  return { importSafari, importSafariDirect, importHtml, chooseSafariExport };
}
