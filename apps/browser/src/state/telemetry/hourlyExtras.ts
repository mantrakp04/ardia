import { takeExportCounts } from "./exportCounts";
import { takeImportRuns } from "./importRuns";
import { takeMemoryTrimCounts } from "./memoryTrimCounts";
import { takePlatformCounts, watchPlatformCounts } from "./platformCounts";
import { takeProfileDataCounts } from "./profileDataCounts";

export { watchPlatformCounts };

export const takeHourlyExtras = () => ({ ...takePlatformCounts(), ...takeImportRuns(), ...takeProfileDataCounts(), ...takeExportCounts(), ...takeMemoryTrimCounts() });
