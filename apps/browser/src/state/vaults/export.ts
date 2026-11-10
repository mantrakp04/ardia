import { exportVault } from "../../platform/vaults";
import { confirm } from "../app/system";
import { plural } from "../browser/model";
import { brandOf } from "./brands";
import { vaultProviderOf } from "./store";

type ConfirmOptions = Parameters<typeof confirm>[0];
export type ExportAsk = (options: ConfirmOptions) => Promise<{ confirmed: boolean }>;

export const EXPORT_WARNING = "Anyone who can open the file can read your passwords.";
export const EXPORT_FAILED = "Couldn't write the file. Try another folder.";

export const exportQuestion = (name: string): ConfirmOptions => ({
  title: `Export your ${name} passwords?`,
  message: `They're saved to a CSV file. ${EXPORT_WARNING}`,
  confirmTitle: "Export",
});

export const exportedLine = (count: number) => `Exported ${plural(count, "password")}. Delete the file once you're done with it.`;

export async function exportManagerPasswords(provider: string, ask: ExportAsk = confirm): Promise<string> {
  const name = vaultProviderOf(provider)?.name ?? brandOf(provider).name;
  const { confirmed } = await ask(exportQuestion(name));
  if (!confirmed) return "";
  const result = await exportVault(provider).catch(() => null);
  if (!result) return EXPORT_FAILED;
  if (result.declined) return "";
  return result.saved ? exportedLine(result.count) : EXPORT_FAILED;
}
