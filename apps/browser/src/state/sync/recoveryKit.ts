import { SyncNative } from "../../platform/sync";

export type { FolderInfo } from "../../platform/sync";

export const recoveryWords = () => SyncNative?.recoveryWords();
export const recoveryQrCode = () => SyncNative?.qrCode();
export const recoveryKitPreview = (width: number) => SyncNative?.recoveryKitPreview(width);
export const saveRecoveryKit = (format: "pdf" | "text") => SyncNative?.saveRecoveryKit(format);
export const copyRecoveryKit = () => SyncNative?.copyRecoveryKit();
export const shareRecoveryKit = () => SyncNative?.shareRecoveryKit();
export const copyRecoveryPhrase = () => SyncNative?.copyRecoveryPhrase();
export const revealSyncFolder = (path: string) => SyncNative?.revealFolder(path);
