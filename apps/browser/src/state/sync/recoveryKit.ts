import { SyncNative } from "../../platform/sync";

export type { FolderInfo } from "../../platform/sync";

export const recoveryWords = () => SyncNative?.recoveryWords();

let codeCounts = { sync_codes_shown: 0, sync_codes_declined: 0 };

export async function recoveryQrCode(): Promise<string | null> {
  const code = (await SyncNative?.qrCode().catch(() => null)) ?? null;
  if (code) codeCounts.sync_codes_shown++;
  else codeCounts.sync_codes_declined++;
  return code;
}

export function takeSyncCodeCounts() {
  const taken = codeCounts;
  codeCounts = { sync_codes_shown: 0, sync_codes_declined: 0 };
  return taken;
}

export const recoveryKitPreview = (width: number) => SyncNative?.recoveryKitPreview(width);
export const saveRecoveryKit = (format: "pdf" | "text") => SyncNative?.saveRecoveryKit(format);
export const copyRecoveryKit = () => SyncNative?.copyRecoveryKit();
export const shareRecoveryKit = () => SyncNative?.shareRecoveryKit();
export const copyRecoveryPhrase = () => SyncNative?.copyRecoveryPhrase();
export const revealSyncFolder = (path: string) => SyncNative?.revealFolder(path);
