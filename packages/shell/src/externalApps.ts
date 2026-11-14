export type ExternalAppLaunches = { opened: number; refused: number; automatic: number };

export type ExternalAppCountsNative = { takeLaunches(): ExternalAppLaunches };
