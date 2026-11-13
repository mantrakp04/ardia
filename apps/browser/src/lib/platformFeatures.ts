export type PlatformFeatures = {
  sharesFiles: boolean;
  syncsWithPhone: boolean;
  dock: boolean;
  appIcon: boolean;
  menuBar: boolean;
  memoryPressure: boolean;
  escapeClosesDownloads: boolean;
  dictation: boolean;
  findsBrowsersBy: "appBundle" | "importList";
  hiddenBrowserSources: readonly string[];
  splitView: boolean;
  setsDefaultBrowser: boolean;
  exportsBookmarksAndPasswords: boolean;
  sync: boolean;
  calendar: boolean;
  webKit: boolean;
  contentBlocker: boolean;
  trackpadGestures: boolean;
  videoUpscaling: boolean;
  thinScrollBars: boolean;
  haptics: boolean;
};

export const PLATFORM_FEATURES: PlatformFeatures = { dock: true, appIcon: true, menuBar: true, memoryPressure: true, escapeClosesDownloads: false, dictation: true, findsBrowsersBy: "appBundle", hiddenBrowserSources: [], splitView: true, setsDefaultBrowser: true, exportsBookmarksAndPasswords: true, sync: true, calendar: true, webKit: true, contentBlocker: true, trackpadGestures: true, videoUpscaling: true, thinScrollBars: true, haptics: true, sharesFiles: true, syncsWithPhone: true };
