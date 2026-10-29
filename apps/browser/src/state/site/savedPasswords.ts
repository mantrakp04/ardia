import { create } from "zustand";
import { onAppEvent } from "../../platform/app";
import { importModule } from "../../platform/importModule";
import { orWarn } from "../../lib/fallback";
import { getPassword, savePassword, unlockPasswords } from "./passwords";

const UNLOCK_MS = 5 * 60_000;

export const usePasswordUnlocks = create<{ unlocked: Record<string, true> }>()(() => ({ unlocked: {} }));

const relocks = new Map<string, ReturnType<typeof setTimeout>>();
let watchingForLock = false;
let revocations = 0;

export function lockPasswords() {
  revocations++;
  for (const timer of relocks.values()) clearTimeout(timer);
  relocks.clear();
  usePasswordUnlocks.setState({ unlocked: {} });
}

function relockLater(profile: string) {
  clearTimeout(relocks.get(profile));
  relocks.set(
    profile,
    setTimeout(() => {
      relocks.delete(profile);
      revocations++;
      usePasswordUnlocks.setState((s) => {
        const { [profile]: _, ...rest } = s.unlocked;
        return { unlocked: rest };
      });
    }, UNLOCK_MS),
  );
}

export async function unlockPasswordsFor(profile: string): Promise<boolean> {
  if (!watchingForLock) {
    watchingForLock = true;
    onAppEvent((e) => e.type === "lockedOrAsleep" && lockPasswords());
  }
  const askedAt = revocations;
  if (!(await unlockPasswords(profile).catch(orWarn(false)))) return false;
  if (askedAt !== revocations) return false;
  relockLater(profile);
  usePasswordUnlocks.setState((s) => ({ unlocked: { ...s.unlocked, [profile]: true } }));
  return true;
}

export const usePasswordsUnlocked = (profile: string) => usePasswordUnlocks((s) => !!s.unlocked[profile]);

export async function revealPassword(profile: string, origin: string, username: string): Promise<string | null> {
  if (!usePasswordUnlocks.getState().unlocked[profile]) return null;
  const askedAt = revocations;
  const password = await getPassword(profile, origin, username).catch(orWarn(null));
  return askedAt === revocations ? password : null;
}

export const originOfLogin = (url: string) => /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)/i.exec(url)?.[1] ?? url;

export type PasswordImport = { saved: number; skipped: number } | "cancelled";

export async function importPasswordsCsv(profile: string): Promise<PasswordImport> {
  const mod = importModule();
  const path = await mod.chooseImportFile("passwordsCSV");
  if (!path) return "cancelled";
  const credentials = await mod.importPasswordsCSV(path);
  let saved = 0;
  for (const c of credentials) {
    if (c.url && c.password && (await savePassword(profile, originOfLogin(c.url), c.username, c.password).catch(orWarn(false)))) saved++;
  }
  return { saved, skipped: credentials.length - saved };
}
