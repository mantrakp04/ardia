import { takeExportCounts } from "./exportCounts";
import { takeImportRuns } from "./importRuns";
import { takePlatformCounts, watchPlatformCounts } from "./platformCounts";

export { watchPlatformCounts };

export const takeHourlyExtras = () => ({ ...takePlatformCounts(), ...takeImportRuns(), ...takeExportCounts() });
