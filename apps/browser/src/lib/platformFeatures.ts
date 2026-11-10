export type PlatformFeatures = {
  dock: boolean;
  appIcon: boolean;
  menuBar: boolean;
  memoryPressure: boolean;
};

export const PLATFORM_FEATURES: PlatformFeatures = { dock: true, appIcon: true, menuBar: true, memoryPressure: true };
