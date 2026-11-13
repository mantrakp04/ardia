import { exportPasswords as exportPasswordsOf } from "../../platform/passwords";
import { notePasswordExport, notePasswordExportFailure } from "../telemetry/exportCounts";

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
  const result = await exportPasswordsOf(profile).catch((error: unknown) => {
    notePasswordExportFailure();
    throw error;
  });
  if (result.status === "succeeded") notePasswordExport();
  if (result.status === "writeFailed") notePasswordExportFailure();
  return result;
}
