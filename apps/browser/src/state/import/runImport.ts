import { ardiaError } from "@ardia/core";
import { orWarn } from "../../lib/fallback";
import { confirm } from "../app/system";
import { plural } from "../browser/model";
import { MAX_DRAFT_LINKS } from "../groups/draftGroups";
import { createProfile } from "../profiles/actions";
import {
  applyResult,
  emptyCounts,
  importArcSpace,
  importDiaProfile,
  profileColorFor,
  profileNamed,
  type BrowserProfile,
  type DiaTabsResult,
  type ImportCounts,
  type ImportedExtension,
  type ImportKind,
  type ImportResult,
} from "./apply";
import { diaProfilesFor } from "./diaTabs";
import {
  APP_TAB_KINDS,
  ENCRYPTED_KINDS,
  finishImport,
  importNow,
  IMPORT_KINDS,
  importSignal,
  importsBySpaces,
  patchImport,
  spacesOf,
  startProgress,
  updateStatus,
} from "./flow";
import { importModule } from "./importApi";

export function continueImport() {
  const { source, step, kinds, sourceProfiles } = importNow();
  if (!source) return;
  if (step.name === "choose") {
    if (source.needsFullDiskAccess) return patchImport({ step: { name: "access" } });
    if (source.requiresExport) return patchImport({ step: { name: "safari", error: null } });
    if (source.profiles.length > 1 || (importsBySpaces(source) && spacesOf(source).length > 1)) return patchImport({ step: { name: "profiles" } });
  }
  const encryptedTabs = kinds.has("tabs") && source.profiles.some((p) => sourceProfiles.includes(p.id) && p.tabsNeedKey);
  const locked = (encryptedTabs || ENCRYPTED_KINDS.some((k) => kinds.has(k))) && source.needsKeychain && !importModule().isBrowserUnlocked(source.id);
  if ((step.name === "choose" || step.name === "profiles") && locked) return patchImport({ step: { name: "unlock", unlocking: false, error: null } });
  void runImport(kinds);
}

export async function unlockAndImport() {
  const { source, step } = importNow();
  if (!source) return;
  const signal = importSignal();
  patchImport({ step: { name: "unlock", unlocking: true, error: step.name === "unlock" ? step.error : null } });
  try {
    await importModule().unlockBrowser(source.id);
  } catch {
    if (!signal.aborted)
      patchImport({ step: { name: "unlock", unlocking: false, error: `macOS didn't allow access to ${source.name}'s keychain item. Try again, or skip the encrypted data.` } });
    return;
  }
  if (!signal.aborted) void runImport(importNow().kinds);
}

export function skipEncryptedData() {
  const kinds = new Set(importNow().kinds);
  kinds.delete("passwords");
  kinds.delete("cookies");
  patchImport({ kinds });
  void runImport(kinds, true);
}

async function destination(target: string, index: number, name: string, color?: string, emoji?: string, shareWith?: string | null): Promise<string> {
  if (index === 0) return target;
  const clash = profileNamed(name);
  if (clash) {
    const { confirmed } = await confirm({
      title: "Import as new profile?",
      message:
        "Import this data as a new profile to avoid data loss. If you replace a profile, your passwords, cookies, and payment info will be replaced, while your bookmarks and history will be combined.",
      confirmTitle: "Import as new profile",
      cancelTitle: "Replace this profile",
    });
    if (!confirmed) return clash;
  }
  return createProfile({ name, color: profileColorFor(color), icon: emoji ?? null, shareWith });
}

type AppTabs = { result: DiaTabsResult } | { note: string };

const NOT_BROUGHT = "Dia's tabs couldn't be brought over:";

function readAppTabs(): Promise<AppTabs> {
  return importModule()
    .readDiaTabs()
    .then(
      (result): AppTabs => (result.windowCount ? { result } : { note: `${NOT_BROUGHT} Dia had no windows open.` }),
      (e: unknown): AppTabs => {
        const { code } = ardiaError(e);
        if (code === "locked")
          return { note: `${NOT_BROUGHT} macOS didn't allow Ardia to ask Dia for them. Allow it in System Settings › Privacy & Security › Automation, then import again.` };
        return { note: `${NOT_BROUGHT} ${code === "notRunning" ? "Dia didn't open." : "Dia didn't answer."}` };
      },
    );
}

function importAppTabs(dest: string, tabs: AppTabs, profiles: BrowserProfile[], profileId: string, wanted: ReadonlySet<ImportKind>): number {
  if (!("result" in tabs)) return 0;
  const dia = diaProfilesFor(tabs.result, profiles).get(profileId);
  if (!dia) return 0;
  return importDiaProfile(dest, dia, { pinned: wanted.has("pinnedTabs"), open: wanted.has("tabs") }, tabs.result.favicons);
}

export async function runImport(wanted: ReadonlySet<ImportKind>, withoutKey = false) {
  const { source, sourceProfiles, spaces, target } = importNow();
  if (!source) return;
  const api = importModule();
  const signal = importSignal();
  const bySpaces = importsBySpaces(source);
  const selected = source.profiles.filter((p) => sourceProfiles.includes(p.id) || (bySpaces && p.spaces?.some((sp) => spaces.includes(sp.id))));
  const tabsLocked = (p: BrowserProfile) => withoutKey && !!p.tabsNeedKey;
  const requested: ImportKind[] = [...wanted].filter((k) => k !== "tabs" || !selected.every(tabsLocked));
  if (bySpaces && requested.includes("tabs")) requested.push("spaces", "pinnedTabs");
  const order = IMPORT_KINDS.filter((k) => requested.includes(k));
  const fromApp = source.asksAppForTabs ? order.filter((k) => APP_TAB_KINDS.includes(k)) : [];
  const fromFiles = order.filter((k) => !fromApp.includes(k));
  startProgress(Object.fromEntries(order.map((k) => [k, fromApp.includes(k) ? "active" : "pending"])), bySpaces ? Math.max(1, spaces.length) : selected.length);
  const total = emptyCounts();
  const failed = new Map<ImportKind, string[]>();
  const add = (c: ImportCounts) => (Object.keys(total) as (keyof ImportCounts)[]).forEach((k) => (total[k] += c[k]));
  let destinationIndex = 0;
  const nextDestination = (name: string, color?: string, emoji?: string, shareWith?: string | null) =>
    destination(target, destinationIndex++, name, color, emoji, shareWith);
  const found = new Map<string, ImportedExtension>();
  const left: string[] = [];
  let extensionsProfile = "";
  const appTabs = fromApp.length ? readAppTabs() : null;
  if (source.family === "firefox" && requested.includes("passwords") && !api.isBrowserUnlocked(source.id)) {
    await api.unlockBrowser(source.id).catch(orWarn(undefined));
  }

  for (const profile of selected) {
    let result: ImportResult;
    const profileKinds = tabsLocked(profile) ? fromFiles.filter((k) => k !== "tabs") : fromFiles;
    try {
      result = await api.importData(source.id, profile.id, profileKinds, {
        spaceIds: bySpaces ? spaces : undefined,
        signal,
        onProgress: (p) => {
          if (p.phase === "start") updateStatus(signal, (st) => ({ ...st, [p.kind]: "active" }));
          if (p.phase === "end") updateStatus(signal, (st) => (st[p.kind] === "failed" ? st : { ...st, [p.kind]: "done" }));
        },
      });
    } catch (e) {
      if (ardiaError(e).code === "cancelled") return;
      for (const k of profileKinds) failed.set(k, [...(failed.get(k) ?? []), profile.name]);
      if (appTabs) {
        const tabs = await appTabs;
        if (signal.aborted) return;
        total.tabs += importAppTabs(await nextDestination(profile.name, profile.color), tabs, source.profiles, profile.id, wanted);
      }
      continue;
    }
    for (const k of result.failed) failed.set(k, [...(failed.get(k) ?? []), profile.name]);
    for (const w of result.warnings) {
      if ((w.code === "undecryptable" || w.code === "skipped" || w.code === "locked") && !result.failed.includes(w.kind)) left.push(`${w.message}.`);
    }
    const refused = (k: ImportKind) => {
      const names = failed.get(k) ?? [];
      if (!names.includes(profile.name)) failed.set(k, [...names, profile.name]);
    };

    if (bySpaces) {
      let first: string | null = null;
      for (const space of result.spaces) {
        const name = space.name || "Space";
        const dest = await nextDestination(name, space.color, space.emoji, first);
        first ??= dest;
        const r = importArcSpace(dest, space, result.favicons);
        add({ ...emptyCounts(), tabs: r.tabs, bookmarks: r.bookmarks });
        if (r.skipped) left.push(`${plural(r.skipped, "link")} in ${name}'s folders weren't imported: each folder brings up to ${MAX_DRAFT_LINKS.toLocaleString("en-US")} links.`);
      }
      const dest = first ?? (await nextDestination(result.profile?.name ?? profile.name, result.profile?.color));
      add(await applyResult(dest, result, source.name, profileKinds, refused));
      extensionsProfile ||= dest;
    } else {
      const dest = await nextDestination(result.profile?.name ?? profile.name, result.profile?.color ?? profile.color);
      add(await applyResult(dest, result, source.name, profileKinds, refused));
      if (appTabs) {
        const tabs = await appTabs;
        if (signal.aborted) return;
        total.tabs += importAppTabs(dest, tabs, source.profiles, profile.id, wanted);
      }
      extensionsProfile ||= dest;
    }
    if (source.family === "chromium" || source.family === "arc") {
      for (const e of await api.listExtensions(source.id, profile.id).catch(orWarn([]))) found.set(e.id, e);
    }
  }
  const appTabsResult = appTabs && (await appTabs);
  if (signal.aborted) return;
  if (appTabsResult) {
    const note = "note" in appTabsResult ? appTabsResult.note : null;
    if (note) left.push(note);
    updateStatus(signal, (st) => ({ ...st, ...Object.fromEntries(fromApp.map((k) => [k, note ? "failed" : "done"])) }));
  }
  updateStatus(signal, (st) => Object.fromEntries(Object.entries(st).map(([k, v]) => [k, failed.has(k as ImportKind) ? "failed" : v === "failed" ? v : "done"])));
  api.forgetUnlockedKeys();
  finishImport(signal, {
    counts: total,
    failures: [...failed].map(([kind, names]) => ({ kind, profiles: selected.length > 1 ? names : [] })),
    notes: left,
    extensions: { profileId: extensionsProfile, list: [...found.values()], opened: false },
  });
}

