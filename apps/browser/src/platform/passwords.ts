import { call, savePassword, updatePassword, type PasswordExportStatus, type SavedPassword } from "@ardia/ardiacore";

export { savePassword, updatePassword };
export type { SavedPassword, PasswordExportStatus };

export const listPasswords = async (profile: string) => (await call("passwords.list", { profile })).passwords;
export const unlockPasswords = async (profile: string) => (await call("passwords.unlock", { profile })).unlocked;
export const getPassword = async (profile: string, origin: string, username: string) =>
  (await call("passwords.reveal", { profile, origin, username })).password;
export const deletePassword = async (profile: string, origin: string, username: string) =>
  !!(await call("passwords.remove", { profile, origin, username }));
export const setNeverSavePasswords = async (profile: string, origin: string, never: boolean) => {
  if (!never) await call("passwords.allowSaving", { profile, origin });
};
export const getNeverSavePasswordOrigins = async (profile: string) => (await call("passwords.neverSaveOrigins", { profile })).origins;
export const exportPasswords = (profile: string) => call("passwords.export", { profile });
export const getPasswordAutofill = (profile = "") => call("passwords.autofillEnabled", { profile });
export const setPasswordAutofill = (enabled: boolean, profile = "") => call("passwords.setAutofillEnabled", { profile, enabled });
