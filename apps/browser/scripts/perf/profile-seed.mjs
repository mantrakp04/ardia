export function profileSeed(origin, count = 8, loadProfilesWhenOpened = true) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("profile-count must be a positive integer");
  const ids = Array.from({ length: count }, (_, i) => i ? `profile-${i}` : "default");
  const windowId = "w-profile-bench";
  const tabs = ids.map((profileId, i) => ({
    id: `t-profile-${i}`, windowId, profileId, url: `${origin}/static?id=profile-${i}`,
    title: `Profile ${i + 1}`, favicon: null, pin: null, muted: false, zoom: 1,
    customTitle: null, customIcon: null, pinnedUrl: null, openerId: null,
    page: { kind: "idle" }, createdAt: 0, lastActiveAt: 0,
  }));
  return {
    version: 9,
    profiles: Object.fromEntries(ids.map((id, i) => [id, { id, name: `Profile ${i + 1}`, color: "plum", icon: null, createdAt: i }])),
    profileOrder: ids,
    settings: { loadProfilesWhenOpened, searchSuggestions: false, warnBeforeClosingWindow: false },
    windows: [{
      id: windowId, profileId: "default", tabIds: tabs.map((tab) => tab.id),
      activeTabIds: Object.fromEntries(tabs.map((tab) => [tab.profileId, tab.id])),
      sidebarOpen: true, frame: [100, 100, 1100, 760], createdAt: 0,
    }],
    windowOrder: [windowId], focusedWindowId: windowId, tabs, groups: [], splits: [], closedTabs: [], closedWindows: [],
  };
}
