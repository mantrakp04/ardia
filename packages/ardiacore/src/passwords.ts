import { ardiaError, call } from "./engine/call";
import { nativeModule } from "./nativeModules";

export type SavedPassword = { origin: string; username: string; created: number; modified: number };

const Passwords = nativeModule("ArdiaPasswords");
const secret = (reply: Promise<string>) =>
  reply.then(
    (json) => JSON.parse(json) as { ok: true },
    (error: unknown) => Promise.reject(ardiaError(error)),
  );

export const listPasswords = async (profile: string): Promise<SavedPassword[]> => (await call("passwords.list", { profile })).passwords;
export const unlockPasswords = async (profile: string): Promise<boolean> => (await call("passwords.unlock", { profile })).unlocked;
export const getPassword = async (profile: string, origin: string, username: string) =>
  (await call("passwords.reveal", { profile, origin, username })).password;
export const savePassword = async (profile: string, origin: string, username: string, password: string) =>
  !!(await secret(Passwords.save(profile, origin, username, password)));
export const updatePassword = async (profile: string, origin: string, username: string, changes: { username?: string; password?: string }) =>
  !!(await secret(Passwords.update(profile, origin, username, changes.username ?? null, changes.password ?? null)));
export const deletePassword = async (profile: string, origin: string, username: string) =>
  !!(await call("passwords.remove", { profile, origin, username }));
export const setNeverSavePasswords = async (profile: string, origin: string, never: boolean) => {
  if (!never) await call("passwords.allowSaving", { profile, origin });
};
export const getNeverSavePasswordOrigins = async (profile: string) => (await call("passwords.neverSaveOrigins", { profile })).origins;
export type PasswordExportStatus = "succeeded" | "cancelled" | "writeFailed" | "reauthFailed" | "inProgress";
export const exportPasswords = (profile: string): Promise<{ status: PasswordExportStatus; path?: string }> => call("passwords.export", { profile });
export const getPasswordAutofill = (profile = "") => call("passwords.autofillEnabled", { profile });
export const setPasswordAutofill = (enabled: boolean, profile = "") => call("passwords.setAutofillEnabled", { profile, enabled });
