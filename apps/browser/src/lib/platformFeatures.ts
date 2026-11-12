export type PlatformFeatures = {
  dock: boolean;
  appIcon: boolean;
  menuBar: boolean;
  memoryPressure: boolean;
  escapeClosesDownloads: boolean;
  dictation: boolean;
  findsBrowsersBy: "appBundle" | "importList";
  hiddenBrowserSources: readonly string[];
};

export const PLATFORM_FEATURES: PlatformFeatures = { dock: true, appIcon: true, menuBar: true, memoryPressure: true, escapeClosesDownloads: false, dictation: true, findsBrowsersBy: "appBundle", hiddenBrowserSources: [] };
