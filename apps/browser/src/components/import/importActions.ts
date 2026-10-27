import { closeWindow } from "../../state/windows/nativeWindow";
import { confirm } from "../../state/app/system";
import { MAX_DRAFT_LINKS } from "../../state/groups/draftGroups";
import { plural } from "../../state/browser/model";
import type { ProfileColor } from "../../state/browser/types";
import { IMPORT_WINDOW_ID } from "../../state/settings/settingsWindows";
import { applyResult, emptyCounts, importArcSpace, profileColorFor, profileNamed, type ImportCounts } from "../../state/import/apply";
import { addProfile } from "../../state/profiles/actions";
import type { importModule } from "../../state/import/importApi";
import { KINDS, type BrowserProfile, type BrowserSource, type ImportedExtension, type ImportKind, type ImportResult, type SpaceSummary } from "./model";
import { APP_TAB_KINDS, importAppTabs, readAppTabs } from "./diaActions";
import { importMotion } from "./tokens";
import { NO_EXTENSIONS, type ImportState } from "./useImportState";

export type ImportApi = NonNullable<ReturnType<typeof importModule>>;

export function importActions(s: ImportState, api: ImportApi | null) {
  const { source, sourceProfiles, spaces, step, kinds, target } = s;
  const allSpaces: (SpaceSummary & { profileId: string })[] = (source?.profiles ?? []).flatMap((p) => (p.spaces ?? []).map((sp) => ({ ...sp, profileId: p.id })));
  const bySpaces = !!source?.sidebar;
  const spaceless = (source?.profiles ?? []).filter((p) => !p.spaces?.length);

  const choose = (b: BrowserSource) => {
    s.setSource(b);
    const defaults = b.profiles.filter((p) => p.isDefault);
    s.setSourceProfiles((defaults.length ? defaults : b.profiles.slice(0, 1)).map((p) => p.id));
    const spaceProfiles = b.sidebar === "arc" || !defaults.length ? b.profiles : defaults;
    s.setSpaces(spaceProfiles.flatMap((p) => p.spaces ?? []).map((sp) => sp.id));
    const available: ImportKind[] = b.requiresExport ? ["bookmarks", "history", "passwords"] : [...new Set(b.profiles.flatMap((p) => p.available))];
    s.setKinds(new Set(available));
    if (b.family === "safari" && api) s.setFullDiskAccess(api.safariHasFullDiskAccess());
    s.setExtensions(NO_EXTENSIONS);
    s.setNotes([]);
    s.setError(null);
  };

  const recheckAccess = async () => {
    if (!api) return;
    if (step === "safari") return s.setFullDiskAccess(api.safariHasFullDiskAccess());
    const list = await api.listBrowsers().catch(() => null);
    if (!list) return;
    s.setBrowsers(list);
    const updated = list.find((b) => b.id === source?.id);
    if (updated && !updated.needsFullDiskAccess) {
      choose(updated);
      s.setStep("choose");
    }
  };

  const destination = async (index: number, name: string, color?: string, emoji?: string, shareWith?: string | null): Promise<string> => {
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
    return addProfile({ name, color: profileColorFor(color) as ProfileColor | undefined, icon: emoji ?? null, shareWith });
  };

  const finish = () => setTimeout(() => s.setStep("done"), importMotion.doneDelay);

  const run = async (wanted: Set<ImportKind>, withoutKey = false) => {
    if (!api || !source) return;
    const selected = source.profiles.filter((p) => sourceProfiles.includes(p.id) || (bySpaces && p.spaces?.some((sp) => spaces.includes(sp.id))));
    const tabsLocked = (p: BrowserProfile) => withoutKey && !!p.tabsNeedKey;
    const requested: ImportKind[] = [...wanted].filter((k) => k !== "tabs" || !selected.every(tabsLocked));
    if (bySpaces && requested.includes("tabs")) requested.push("spaces", "pinnedTabs");
    const order = KINDS.map((k) => k.kind).filter((k) => requested.includes(k));
    const fromApp = source.asksAppForTabs ? order.filter((k) => APP_TAB_KINDS.includes(k)) : [];
    const fromFiles = order.filter((k) => !fromApp.includes(k));
    s.setStatus(Object.fromEntries(order.map((k) => [k, fromApp.includes(k) ? "active" : "pending"])));
    s.setPreparing(bySpaces ? Math.max(1, spaces.length) : selected.length);
    s.setStep("progress");
    s.abort.current = new AbortController();
    const signal = s.abort.current.signal;
    const total = emptyCounts();
    const failed = new Map<ImportKind, string[]>();
    const add = (c: ImportCounts) => (Object.keys(total) as (keyof ImportCounts)[]).forEach((k) => (total[k] += c[k]));
    let destinationIndex = 0;
    const found = new Map<string, ImportedExtension>();
    const left: string[] = [];
    let extensionsProfile = "";
    const appTabs = fromApp.length ? readAppTabs(api) : null;
    if (source.family === "firefox" && requested.includes("passwords") && !api.isBrowserUnlocked(source.id)) {
      await api.unlockBrowser(source.id).catch(() => {});
    }

    for (const profile of selected) {
      let result: ImportResult;
      const profileKinds = tabsLocked(profile) ? fromFiles.filter((k) => k !== "tabs") : fromFiles;
      try {
        result = await api.importData(source.id, profile.id, profileKinds, {
          spaceIds: bySpaces ? spaces : undefined,
          signal,
          onProgress: (p) => {
            if (p.phase === "start") s.setStatus((st) => ({ ...st, [p.kind]: "active" }));
            if (p.phase === "end") s.setStatus((st) => (st[p.kind] === "failed" ? st : { ...st, [p.kind]: "done" }));
          },
        });
      } catch (e) {
        if ((e as { code?: string }).code === "cancelled") return;
        for (const k of profileKinds) failed.set(k, [...(failed.get(k) ?? []), profile.name]);
        if (appTabs) {
          const tabs = await appTabs;
          if (signal.aborted) return;
          total.tabs += importAppTabs(await destination(destinationIndex++, profile.name, profile.color), tabs, source.profiles, profile.id, wanted);
        }
        continue;
      }
      for (const k of result.failed) failed.set(k, [...(failed.get(k) ?? []), profile.name]);
      for (const w of result.warnings) {
        if (["undecryptable", "skipped", "locked"].includes(w.code) && !result.failed.includes(w.kind!)) left.push(`${w.message}.`);
      }
      const refused = (k: ImportKind) => {
        const names = failed.get(k) ?? [];
        if (!names.includes(profile.name)) failed.set(k, [...names, profile.name]);
      };

      if (bySpaces) {
        let first: string | null = null;
        for (const space of result.spaces) {
          const name = space.name || "Space";
          const dest = await destination(destinationIndex++, name, space.color, space.emoji, first);
          first ??= dest;
          const r = importArcSpace(dest, space, result.favicons);
          add({ ...emptyCounts(), tabs: r.tabs, bookmarks: r.bookmarks });
          if (r.skipped) left.push(`${plural(r.skipped, "link")} in ${name}'s folders weren't imported: each folder brings up to ${MAX_DRAFT_LINKS.toLocaleString("en-US")} links.`);
        }
        const dest = first ?? (await destination(destinationIndex++, result.profile?.name ?? profile.name, result.profile?.color));
        add(await applyResult(dest, result, source.name, profileKinds, refused));
        extensionsProfile ||= dest;
      } else {
        const dest = await destination(destinationIndex++, result.profile?.name ?? profile.name, result.profile?.color ?? profile.color);
        add(await applyResult(dest, result, source.name, profileKinds, refused));
        if (appTabs) {
          const tabs = await appTabs;
          if (signal.aborted) return;
          total.tabs += importAppTabs(dest, tabs, source.profiles, profile.id, wanted);
        }
        extensionsProfile ||= dest;
      }
      if (source.family === "chromium" || source.family === "arc") {
        for (const e of await api.listExtensions(source.id, profile.id).catch(() => [])) found.set(e.id, e);
      }
    }
    const appTabsResult = appTabs && (await appTabs);
    if (signal.aborted) return;
    if (appTabsResult) {
      const note = "note" in appTabsResult ? appTabsResult.note : null;
      if (note) left.push(note);
      s.setStatus((st) => ({ ...st, ...Object.fromEntries(fromApp.map((k) => [k, note ? "failed" : "done"])) }));
    }
    s.setExtensions({ profileId: extensionsProfile, list: [...found.values()], opened: false });
    s.setNotes(left);
    s.setStatus((st) => Object.fromEntries(Object.entries(st).map(([k, v]) => [k, failed.has(k as ImportKind) ? "failed" : v === "failed" ? v : "done"])));
    s.setFailures([...failed].map(([kind, names]) => ({ kind, profiles: selected.length > 1 ? names : [] })));
    s.setCounts(total);
    api.forgetUnlockedKeys();
    finish();
  };

  const unlock = async () => {
    if (!api || !source) return;
    s.setUnlocking(true);
    try {
      await api.unlockBrowser(source.id);
      s.setUnlocking(false);
      void run(kinds);
    } catch {
      s.setUnlocking(false);
      s.setError(`macOS didn't allow access to ${source.name}'s keychain item. Try again, or skip the encrypted data.`);
    }
  };

  const close = () => void closeWindow(IMPORT_WINDOW_ID);

  return { allSpaces, bySpaces, spaceless, choose, recheckAccess, destination, finish, run, unlock, close };
}

export type ImportCore = ReturnType<typeof importActions>;
