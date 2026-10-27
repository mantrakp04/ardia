import { useEffect } from "react";
import { AppState } from "react-native";
import { importModule } from "../../state/import/importApi";
import { takePreferredImportSource } from "../../state/settings/settingsWindows";
import { fileImports } from "./fileImports";
import { importActions } from "./importActions";
import { ENCRYPTED, type ImportKind } from "./model";
import { useImportState } from "./useImportState";

export function useImportFlow() {
  const api = importModule();
  const s = useImportState();
  const core = importActions(s, api);
  const files = fileImports(s, api, core);
  const { step, source, kinds, sourceProfiles, fullDiskAccess } = s;

  useEffect(() => {
    if (!api || !((step === "safari" && !fullDiskAccess) || step === "access")) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void core.recheckAccess();
    });
    return () => sub.remove();
  }, [step, fullDiskAccess, api, source?.id]);

  useEffect(() => {
    if (!api) return s.setStep("choose");
    void api
      .listBrowsers()
      .then((list) => {
        s.setBrowsers(list);
        const preferred = takePreferredImportSource();
        const first = list.find((b) => b.id === preferred) ?? list.find((b) => !b.needsFullDiskAccess && !b.requiresExport) ?? list[0];
        if (first) core.choose(first);
        s.setStep("choose");
      })
      .catch(() => s.setStep("choose"));
    return () => {
      s.abort.current?.abort();
      api.forgetUnlockedKeys();
    };
  }, []);

  const next = () => {
    if (!source) return;
    s.setError(null);
    if (step === "choose") {
      if (source.needsFullDiskAccess) return s.setStep("access");
      if (source.requiresExport) return s.setStep("safari");
      if (source.profiles.length > 1 || (core.bySpaces && core.allSpaces.length > 1)) return s.setStep("profiles");
    }
    const encryptedTabs = kinds.has("tabs") && source.profiles.some((p) => sourceProfiles.includes(p.id) && p.tabsNeedKey);
    if ((step === "choose" || step === "profiles") && (encryptedTabs || ENCRYPTED.some((k) => kinds.has(k))) && source.needsKeychain && api && !api.isBrowserUnlocked(source.id)) {
      return s.setStep("unlock");
    }
    void core.run(kinds);
  };

  useEffect(() => {
    if (!__DEV__) return;
    const g = globalThis as { acImport?: object };
    g.acImport = {
      select: (id: string) => {
        const b = s.browsers.find((x) => x.id === id);
        if (b) core.choose(b);
        return !!b;
      },
      next,
      back: () => s.setStep("choose"),
      unlock: core.unlock,
      kinds: [...kinds],
      setKinds: (list: ImportKind[]) => s.setKinds(new Set(list)),
      counts: s.counts,
      failures: s.failures,
      extensions: s.extensions,
      notes: s.notes,
      step,
      status: s.status,
      setSourceProfiles: s.setSourceProfiles,
    };
    return () => void delete g.acImport;
  });

  return { ...s, ...core, ...files, api, next };
}

export type ImportFlow = ReturnType<typeof useImportFlow>;
