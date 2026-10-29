import { AppState } from "react-native";
import { create } from "zustand";
import { orWarn } from "../../lib/fallback";
import { IMPORT_WINDOW_ID, takePreferredImportSource } from "../settings/settingsWindows";
import { closeWindow } from "../windows/nativeWindow";
import { defaultTarget, openInWebStore, type BrowserSource, type ImportCounts, type ImportedExtension, type ImportKind } from "./apply";
import { importModule } from "./importApi";

export type KindStatus = "pending" | "active" | "done" | "failed";
export type ImportStatus = Partial<Record<ImportKind, KindStatus>>;
export type ImportFailure = { kind: ImportKind; profiles: string[] };
export type FoundExtensions = { profileId: string; list: ImportedExtension[]; opened: boolean };
export type ImportResults = { counts: ImportCounts; failures: ImportFailure[]; notes: string[]; extensions: FoundExtensions };

export type ImportStep =
  | { name: "loading" }
  | { name: "choose"; error: string | null }
  | { name: "profiles" }
  | { name: "access" }
  | { name: "safari"; error: string | null }
  | { name: "unlock"; unlocking: boolean; error: string | null }
  | { name: "progress"; status: ImportStatus; preparing: number }
  | ({ name: "done" } & ImportResults);
export type ImportStepName = ImportStep["name"];

export type ImportFlow = {
  browsers: BrowserSource[];
  source: BrowserSource | null;
  sourceProfiles: string[];
  spaces: string[];
  kinds: ReadonlySet<ImportKind>;
  target: string;
  safariCookies: boolean;
  fullDiskAccess: boolean;
  step: ImportStep;
};

export const IMPORT_KINDS: ImportKind[] = ["bookmarks", "history", "passwords", "cookies", "autofill", "tabs", "spaces", "pinnedTabs", "favorites"];
export const ENCRYPTED_KINDS: ImportKind[] = ["passwords", "cookies", "autofill"];
export const APP_TAB_KINDS: ImportKind[] = ["tabs", "pinnedTabs"];
export const NO_EXTENSIONS: FoundExtensions = { profileId: "", list: [], opened: false };

const freshFlow = (target: string): ImportFlow => ({
  browsers: [],
  source: null,
  sourceProfiles: [],
  spaces: [],
  kinds: new Set(),
  target,
  safariCookies: true,
  fullDiskAccess: false,
  step: { name: "loading" },
});

export const useImportFlow = create<ImportFlow>()(() => freshFlow(""));

export const importNow = () => useImportFlow.getState();
export const patchImport = (patch: Partial<ImportFlow>) => useImportFlow.setState(patch);

let session = new AbortController();
let doneDelay = 0;

export const importSignal = () => session.signal;

export const importsBySpaces = (source: BrowserSource | null) => !!source?.sidebar;
export const spacesOf = (source: BrowserSource | null) =>
  (source?.profiles ?? []).flatMap((p) => (p.spaces ?? []).map((sp) => ({ ...sp, profileId: p.id })));
export const spacelessProfiles = (source: BrowserSource | null) => (source?.profiles ?? []).filter((p) => !p.spaces?.length);

const waitsForAccess = ({ step, fullDiskAccess }: ImportFlow) => (step.name === "safari" && !fullDiskAccess) || step.name === "access";

export function startImport(delayBeforeDone: number): () => void {
  session.abort();
  const own = (session = new AbortController());
  doneDelay = delayBeforeDone;
  useImportFlow.setState(freshFlow(defaultTarget()), true);
  const api = importModule();
  void api.listBrowsers().then(
    (list) => {
      if (own.signal.aborted) return;
      patchImport({ browsers: list });
      const preferred = takePreferredImportSource();
      const first = list.find((b) => b.id === preferred) ?? list.find((b) => !b.needsFullDiskAccess && !b.requiresExport) ?? list[0];
      if (first) chooseSource(first);
      else patchImport({ step: { name: "choose", error: null } });
    },
    () => {
      if (!own.signal.aborted) patchImport({ step: { name: "choose", error: null } });
    },
  );
  const appState = AppState.addEventListener("change", (state) => {
    if (state === "active" && waitsForAccess(importNow())) void recheckAccess();
  });
  return () => {
    own.abort();
    appState.remove();
    api.forgetUnlockedKeys();
  };
}

export function chooseSource(b: BrowserSource) {
  const defaults = b.profiles.filter((p) => p.isDefault);
  const spaceProfiles = b.sidebar === "arc" || !defaults.length ? b.profiles : defaults;
  const available: ImportKind[] = b.requiresExport ? ["bookmarks", "history", "passwords"] : b.profiles.flatMap((p) => p.available);
  patchImport({
    source: b,
    sourceProfiles: (defaults.length ? defaults : b.profiles.slice(0, 1)).map((p) => p.id),
    spaces: spaceProfiles.flatMap((p) => p.spaces ?? []).map((sp) => sp.id),
    kinds: new Set(available),
    ...(b.family === "safari" ? { fullDiskAccess: importModule().safariHasFullDiskAccess() } : {}),
    step: { name: "choose", error: null },
  });
}

const toggled = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id));

export function toggleImportKind(kind: ImportKind, on: boolean) {
  const kinds = new Set(importNow().kinds);
  if (on) kinds.add(kind);
  else kinds.delete(kind);
  patchImport({ kinds });
}

export const setImportKinds = (kinds: Iterable<ImportKind>) => patchImport({ kinds: new Set(kinds) });
export const toggleSourceProfile = (id: string, on: boolean) => patchImport({ sourceProfiles: toggled(importNow().sourceProfiles, id, on) });
export const toggleImportSpace = (id: string, on: boolean) => patchImport({ spaces: toggled(importNow().spaces, id, on) });
export const setImportTarget = (target: string) => patchImport({ target });
export const setSafariCookies = (safariCookies: boolean) => patchImport({ safariCookies });
export const backTo = (name: "choose" | "profiles") => patchImport({ step: name === "choose" ? { name, error: null } : { name } });
export const closeImport = () => void closeWindow(IMPORT_WINDOW_ID);
export function cancelImport() {
  session.abort();
  closeImport();
}

export async function recheckAccess() {
  const api = importModule();
  if (importNow().step.name === "safari") return patchImport({ fullDiskAccess: api.safariHasFullDiskAccess() });
  const { signal } = session;
  const list = await api.listBrowsers().catch(orWarn(null));
  if (!list || signal.aborted) return;
  patchImport({ browsers: list });
  const updated = list.find((b) => b.id === importNow().source?.id);
  if (updated && !updated.needsFullDiskAccess) chooseSource(updated);
}

export function openFoundExtensions() {
  const { step, target } = importNow();
  if (step.name !== "done") return;
  openInWebStore(step.extensions.profileId || target, step.extensions.list.map((e) => e.webStoreUrl));
  patchImport({ step: { ...step, extensions: { ...step.extensions, opened: true } } });
}

export function updateStatus(signal: AbortSignal, change: (status: ImportStatus) => ImportStatus) {
  const { step } = importNow();
  if (!signal.aborted && step.name === "progress") patchImport({ step: { ...step, status: change(step.status) } });
}

export function startProgress(status: ImportStatus, preparing: number) {
  patchImport({ step: { name: "progress", status, preparing } });
}

export function finishImport(signal: AbortSignal, results: ImportResults) {
  setTimeout(() => {
    if (!signal.aborted) patchImport({ step: { name: "done", ...results } });
  }, doneDelay);
}

