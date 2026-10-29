import { savePassword as sharedSavePassword } from "../../browser/src/state/site/passwords.ts";
import { claimImportHandle, isImportHandle } from "./importHandles.ts";

export * from "../../browser/src/state/site/passwords.ts";

export const savePassword: typeof sharedSavePassword = (profile, origin, username, password) =>
  isImportHandle(password) ? claimImportHandle(password, profile) : sharedSavePassword(profile, origin, username, password);
