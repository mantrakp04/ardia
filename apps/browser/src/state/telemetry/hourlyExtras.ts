import { takeDownloadsPanelCounts } from "./downloadsPanelCounts";
import { takeExportCounts } from "./exportCounts";
import { takeFirstRunCounts } from "./firstRunCounts";
import { takeImportRuns } from "./importRuns";
import { takeInlineCompletionCounts } from "./inlineCompletionCounts";
import { takeMemoryTrimCounts } from "./memoryTrimCounts";
import { takePlatformCounts, watchPlatformCounts } from "./platformCounts";
import { takeProfileDataCounts } from "./profileDataCounts";
import { takeSyncFileCounts } from "./syncFileCounts";

export { watchPlatformCounts };

export const takeHourlyExtras = () => ({ ...takePlatformCounts(), ...takeImportRuns(), ...takeProfileDataCounts(), ...takeExportCounts(), ...takeInlineCompletionCounts(), ...takeFirstRunCounts(), ...takeMemoryTrimCounts(), ...takeDownloadsPanelCounts(), ...takeSyncFileCounts() });
