import { decodeReply } from "./engine/call";
import { nativeModule } from "./nativeModules";

export type SavedPassword = { origin: string; username: string; created: number; modified: number };
export type PasswordExportStatus = "succeeded" | "cancelled" | "writeFailed" | "reauthFailed" | "inProgress";

const Passwords = nativeModule("ArdiaPasswords");

export const savePassword = async (profile: string, origin: string, username: string, password: string) =>
  !!(await decodeReply<{ ok: true }>(Passwords.save(profile, origin, username, password)));
export const updatePassword = async (profile: string, origin: string, username: string, changes: { username?: string; password?: string }) =>
  !!(await decodeReply<{ ok: true }>(Passwords.update(profile, origin, username, changes.username ?? null, changes.password ?? null)));
