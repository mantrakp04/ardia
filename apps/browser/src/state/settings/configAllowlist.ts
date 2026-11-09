import type { SettingKey } from "./settings";

export const CONFIG_SETTING_KEYS: readonly SettingKey[] = [
  "warnBeforeQuitting", "warnBeforeClosingWindow", "restoreSession", "searchEngine", "searchSuggestions", "showSelectionSearch",
  "commandBarPreference", "tabLayout", "autoHideTabs", "sidebarSide", "hideToolbarWhileScrolling", "newTabPosition", "newTabButtonPosition", "newTabOpens",
  "warnBeforeClosingLastTab", "undoReopensClosedTab", "warnBeforeMovingTabsToProfile", "shareTabsAcrossWindows", "tabReorderHaptics",
  "extendWebsiteColor", "cmdClickCreatesTabGroup", "optShiftClickOpensInGroup", "dragToGroupInTopStrip", "peekModifier", "peekLinksToOtherSites", "newTabLinksOpenIn",
  "splitLinkModifier", "autoGroupMeetingTabs", "cleanUpInactiveTabsAfterMinutes", "mutedSites", "neverTranslateSites",
  "autoPictureInPicture", "commandScrollZoom", "videoUpscaling", "sidebarMediaControls", "sidebarWidth", "showSidebarButton",
  "showClearButton", "balancedTopApps", "showAdvancedSettings", "selectedTabGlow", "interfaceStyle", "glassTintWithTheme",
  "glassTintAmount", "pageScrollBars", "fadeUnloadedTabs", "warnBeforeClosingTabGroup", "batterySaverWhen", "memorySaver",
  "memorySaverMode", "loadProfilesWhenOpened", "keepActiveSites", "extensionSidePanelWidth", "showFullUrl", "showBookmarks", "bookmarksBar", "bookmarksBarSize",
  "hideBookmarksBarImport", "appearance", "addressBar", "compactToolbar", "pageFrame", "commandBarPlacement", "spacesFollowAppearance",
  "profileSwitcherIcons", "shortcuts", "openLinksInLittleArdia", "littleArdiaOpensNewTabLinks", "littleArdiaSize",
  "omniboxProviders", "launchActions",
];

export const CONFIG_EXCLUDED_KEYS: readonly SettingKey[] = [
  "customSearchUrl", "customSearchEngines", "extensionSearchEngines", "allowJavaScriptFromAppleEvents", "cliControl", "defaultProfileId",
  "pageEngine", "websiteEngines", "protectedVideoInWebKit",
];

const ALLOWED: ReadonlySet<string> = new Set(CONFIG_SETTING_KEYS);

export const isConfigSettingKey = (key: string): key is SettingKey => ALLOWED.has(key);
