import { SyncNative } from "../../platform/sync";

export function takeSyncFileCounts() {
  const counts = SyncNative?.takeFileCounts?.();
  if (!counts) return {};
  return { sync_files_online_only: counts.placeholders, sync_files_busy: counts.busy, sync_files_downloaded: counts.hydrated };
}
