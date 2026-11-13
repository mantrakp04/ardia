import { takeExportCounts } from "./exportCounts";
import { takeFirstRunCounts } from "./firstRunCounts";
import { takeImportRuns } from "./importRuns";
import { takePlatformCounts, watchPlatformCounts } from "./platformCounts";
import { takeProfileDataCounts } from "./profileDataCounts";

export { watchPlatformCounts };

export const takeHourlyExtras = () => ({ ...takePlatformCounts(), ...takeImportRuns(), ...takeProfileDataCounts(), ...takeExportCounts(), ...takeFirstRunCounts() });
