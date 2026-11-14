import type { LegacyInput } from "../src/state/legacy/importRules.ts";

export const T = 1_790_000_000_000;

export function legacyData(): LegacyInput {
  return {
    version: 1,
    tabs: [
      {
        id: "6F9619FF-8B86-D011-B42D-00C04FC964FF",
        url: "https://en.wikipedia.org/wiki/Otter",
        title: "Otter - Wikipedia",
        created: T,
        lastActive: T + 5_000,
        position: 1024,
        origin: "search",
        profileSyncId: "work",
        savedState: "AAECAw==",
        faviconUrl: "https://en.wikipedia.org/favicon.ico",
        themeColor: "#FFFFFF",
        snapshotPath: "/var/mobile/Containers/Data/Application/X/Library/Caches/TabSnapshots/otter.jpg",
      },
      {
        id: "1B4E28BA-2FA1-11D2-883F-0016D3CCA427",
        url: "https://example.com/",
        title: "Example Domain",
        created: T + 1_000,
        lastActive: T + 9_000,
        position: 2048,
        origin: "sent",
        receivedKey: "k-1",
        receivedFromDevice: "Mac Studio",
      },
      { id: "AAAA0000-0000-0000-0000-000000000001", url: "file:///etc/passwd", title: "bad", created: T, lastActive: T, position: 3072, origin: "typed" },
    ],
    selectedTabId: "1B4E28BA-2FA1-11D2-883F-0016D3CCA427",
    archive: [
      { id: "C0FFEE00-0000-0000-0000-000000000002", url: "https://news.example/", title: "News", created: T - 9_000, lastActive: T - 8_000, position: 512, origin: "weird", archivedAt: T - 7_000 },
    ],
    visits: [
      { url: "https://example.com/", title: "Example Domain", visitedAt: T + 2_000, transition: "link" },
      { url: "https://en.wikipedia.org/wiki/Otter", title: "Otter", visitedAt: T + 1_000, transition: "typed", profileSyncId: "work" },
      { url: "https://www.google.com/search?q=otters", title: "otters - Google Search", visitedAt: T, transition: "formSubmit" },
      { url: "javascript:void(0)", title: "", visitedAt: T, transition: "other" },
      { url: "https://odd.example/", title: "Odd", visitedAt: T + 3_000, transition: "hyperjump" },
    ],
    preferences: {
      "tabs.autoArchiveInterval": "week",
      "browsing.nightShade": "automatic",
      "browsing.searchEngine": "duckduckgo",
      "browsing.searchSuggestions": false,
      "settings.finishedOnboarding": true,
      "settings.color": "green",
      "settings.autoOpenKeyboard": true,
      "reader.sizeStep": 4,
      "reader.serif": false,
      "reader.theme": "",
      "browsing.swipeNavigation": "sideways",
      "blocking.ads": true,
      "blocking.exemptHosts": ["example.com"],
      "browsing.sites": { "example.com": { nightShade: "always" } },
      "defaultBrowser.askedAt": 1_789_000_000,
      "filters.selection": ["easylist"],
      "settings.bottom": 812,
    },
  };
}
