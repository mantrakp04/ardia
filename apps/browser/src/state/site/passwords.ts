import { exportPasswords as exportPasswordsOf } from "../../platform/passwords";
import { notePasswordExport } from "../telemetry/exportCounts";

export {
  deletePassword,
  getNeverSavePasswordOrigins,
  getPassword,
  listPasswords,
  savePassword,
  setNeverSavePasswords,
  setPasswordAutofill,
  unlockPasswords,
  updatePassword,
  type PasswordExportStatus,
  type SavedPassword,
} from "../../platform/passwords";

export async function exportPasswords(profile: string) {
  const result = await exportPasswordsOf(profile);
  if (result.status === "succeeded") notePasswordExport();
  return result;
}
