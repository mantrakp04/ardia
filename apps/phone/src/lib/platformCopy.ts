export type CopyPlatform = "android" | "ios";

export type DefaultBrowserSteps = { title: string; subtitle: string; steps: string[]; action: string };

export type PlatformCopy = {
  thisDevice: string;
  deviceNameHeader: string;
  syncHero: string;
  syncTabsStay: string;
  stopSyncingFooter: string;
  syncFeatureFooter: string;
  phraseStays: string;
  keySaveFailed: string;
  folderUnavailable: string;
  chooseFolderDetail: string;
  historyClears: string;
  privacy: string;
  cantScanTitle: string;
  alreadyPinnedToast: string;
  filterRulesUnsupported: string;
  readerSerif: { label: string; family: string };
  readerSans: { label: string; family: string };
  voicePermission: string;
  defaultBrowserInstructions: DefaultBrowserSteps | null;
  offersDefaultBrowserAlways: boolean;
};

const ANDROID: PlatformCopy = {
  thisDevice: "This Phone",
  deviceNameHeader: "This Phone’s Name",
  syncHero: "Your Mac’s tabs here, and this phone’s on your Mac.",
  syncTabsStay: "Tabs on this phone stay.",
  stopSyncingFooter: "Your Mac stops seeing this phone’s tabs.",
  syncFeatureFooter: "End-to-end encrypted, in a folder you choose.",
  phraseStays: "Your recovery phrase stays on this phone.",
  keySaveFailed: "Couldn’t save the sync key on this phone.",
  folderUnavailable: "Ardia can’t open this folder. Choose the Ardia Sync folder your Mac syncs to.",
  chooseFolderDetail: "Choose the Ardia Sync folder your Mac syncs to.",
  historyClears: "History clears from this phone. Your Mac’s history stays on your Mac.",
  privacy: "No accounts. Your data stays on your devices and in the sync folder you choose.",
  cantScanTitle: "Can’t Scan on This Phone",
  alreadyPinnedToast: "Pinned to Your Mac",
  filterRulesUnsupported: "Some rules need features Ardia can’t run.",
  readerSerif: { label: "Serif", family: "serif" },
  readerSans: { label: "Sans Serif", family: "sans-serif" },
  voicePermission: "Allow Microphone for Ardia in Settings to search with your voice.",
  defaultBrowserInstructions: null,
  offersDefaultBrowserAlways: true,
};

const IOS: PlatformCopy = {
  thisDevice: "This iPhone",
  deviceNameHeader: "This iPhone’s Name",
  syncHero: "Your Mac’s tabs here, and this iPhone’s on your Mac.",
  syncTabsStay: "Tabs on this iPhone stay.",
  stopSyncingFooter: "Your Mac stops seeing this iPhone’s tabs.",
  syncFeatureFooter: "End-to-end encrypted, in your own iCloud Drive.",
  phraseStays: "Your recovery phrase stays in this iPhone’s Keychain.",
  keySaveFailed: "Couldn’t save the sync key in your Keychain.",
  folderUnavailable: "Ardia can’t open this folder. Choose the Ardia Sync folder in iCloud Drive.",
  chooseFolderDetail: "Choose the Ardia Sync folder in iCloud Drive.",
  historyClears: "History clears from this iPhone. Your Mac’s history stays on your Mac.",
  privacy: "No accounts. Your data stays on your devices and in your iCloud Drive.",
  cantScanTitle: "Can’t Scan on This iPhone",
  alreadyPinnedToast: "Already Pinned to Your Mac",
  filterRulesUnsupported: "Some rules need features Safari can’t run.",
  readerSerif: { label: "New York", family: "ui-serif" },
  readerSans: { label: "San Francisco", family: "ui-sans-serif" },
  voicePermission: "Allow Microphone and Speech Recognition for Ardia in Settings to search with your voice.",
  defaultBrowserInstructions: {
    title: "How to change your default browser",
    subtitle: "Open links from other apps in Ardia.",
    steps: ["Open Ardia in Settings", "Tap on “Default Browser App”", "Select Ardia"],
    action: "Open Ardia in Settings",
  },
  offersDefaultBrowserAlways: false,
};

const TABLES: Record<CopyPlatform, PlatformCopy> = { android: ANDROID, ios: IOS };

let current: PlatformCopy = ANDROID;

export const copyTable = (platform: CopyPlatform): PlatformCopy => TABLES[platform];

export function selectCopy(os: string) {
  current = TABLES[os === "ios" ? "ios" : "android"];
}

export const copy = (): PlatformCopy => current;
