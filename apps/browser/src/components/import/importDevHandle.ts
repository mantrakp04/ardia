import { useEffect } from "react";
import { emptyCounts, type ImportKind } from "../../state/import/apply";
import { importSafariDirect, importSafariExport } from "../../state/import/fileImports";
import { backTo, chooseSource, closeImport, NO_EXTENSIONS, setImportKinds, type ImportFlow } from "../../state/import/flow";
import { continueImport, skipEncryptedData, unlockAndImport } from "../../state/import/runImport";
import { devRegister } from "../dev/devRegister";

export function useImportDevHandle(flow: ImportFlow) {
  useEffect(() => {
    const { step } = flow;
    const done = step.name === "done" ? step : null;
    return devRegister("acImport", null, {
      select: (id: string) => {
        const b = flow.browsers.find((x) => x.id === id);
        if (b) chooseSource(b);
        return !!b;
      },
      next: continueImport,
      back: () => backTo("choose"),
      unlock: unlockAndImport,
      skipEncrypted: skipEncryptedData,
      importSafariDirect,
      importSafari: importSafariExport,
      close: closeImport,
      kinds: [...flow.kinds],
      setKinds: (list: ImportKind[]) => setImportKinds(list),
      counts: done?.counts ?? emptyCounts(),
      failures: done?.failures ?? [],
      extensions: done?.extensions ?? NO_EXTENSIONS,
      notes: done?.notes ?? [],
      step: step.name,
      error: "error" in step ? step.error : null,
      status: step.name === "progress" ? step.status : {},
      preparing: step.name === "progress" ? step.preparing : 1,
      source: flow.source?.id ?? null,
      sourceProfiles: flow.sourceProfiles,
      spaces: flow.spaces,
      fullDiskAccess: flow.fullDiskAccess,
    });
  });
}
