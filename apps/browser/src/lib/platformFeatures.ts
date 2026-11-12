export type PlatformFeatures = {
  dock: boolean;
  appIcon: boolean;
  menuBar: boolean;
  memoryPressure: boolean;
  escapeClosesDownloads: boolean;
  panelGrowsFromField: boolean;
  dictation: boolean;
};

export const PLATFORM_FEATURES: PlatformFeatures = { dock: true, appIcon: true, menuBar: true, memoryPressure: true, escapeClosesDownloads: false, panelGrowsFromField: true, dictation: true };
