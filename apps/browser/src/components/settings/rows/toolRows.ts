import { type SettingSection } from "./types";
import type { SettingsPane } from "../../../state/settings/settingsWindows";

export const toolRows: Pick<Record<SettingsPane, SettingSection[]>, "shortcuts" | "liveFolders" | "calendar" | "engines" | "advanced"> = {
  shortcuts: [
    {
      section: "Keyboard Shortcuts",
      rows: {
        undoReopensClosedTab: {
          title: "⌘Z reopens closed tabs",
          description: "Outside text fields, as in Arc; press it again for the tab closed before. In a text field ⌘Z still undoes typing.",
          keywords: ["undo", "undo close tab", "reopen", "restore tab", "arc", "cmd z"],
        },
        actions: { title: "Customize keyboard shortcuts", keywords: ["hotkeys", "keybindings", "remap", "menu shortcuts"] },
      },
    },
    { section: "Extensions", rows: { extensionShortcuts: { title: "Extension shortcuts", description: "Shortcuts that extensions add, like opening their popup.", keywords: ["hotkeys"] } } },
  ],
  liveFolders: [
    {
      section: "Live folders",
      rows: {
        folders: { title: "Live folders", description: "Live folders refresh every few minutes; items open as tabs that stay in the folder.", keywords: ["new live folder", "hidden", "refresh"] },
        groupStacks: { title: "Group stacked pull requests", description: "Pull requests based on each other's branches sit together under one row.", keywords: ["stack", "stacked pull requests"] },
        showCompleted: { title: "Show completed pull requests", description: "Merged, closed and reviewed pull requests stay listed for a day under Completed.", keywords: ["completed", "merged", "closed"] },
      },
    },
    {
      section: "Pull Requests",
      rows: {
        github: { title: "GitHub", description: "Your open pull requests and the ones waiting for your review, with checks and conflicts.", keywords: ["pull requests", "connect"] },
        bitbucket: { title: "Bitbucket", description: "Your open pull requests on Bitbucket Cloud, with build status.", keywords: ["pull requests", "connect"] },
      },
    },
    {
      section: "Documents",
      rows: {
        notion: { title: "Notion", description: "Pages recently edited in your workspace.", keywords: ["documents", "connect"] },
        confluence: { title: "Confluence", description: "Pages you created, edited or watch.", keywords: ["documents", "atlassian", "connect"] },
        gdrive: { title: "Google Drive", description: "Documents recently changed in your Drive.", keywords: ["documents", "docs", "connect"] },
      },
    },
  ],
  calendar: [
    { section: "Live Calendar", rows: { access: { title: "Calendar access", keywords: ["connect calendar", "google calendar", "outlook", "icloud"] } } },
    {
      section: "Meeting alerts",
      rows: {
        nextAlert: { title: "Show next meeting alert", keywords: ["reminder", "notification", "join"] },
        alertCondition: { title: "Show alerts", description: "With Always, alerts also appear in Notification Center while you're in another app.", keywords: ["notifications"] },
      },
    },
    {
      section: "Pinned calendar",
      rows: {
        preview: { title: "Show calendar preview", description: "Hover a pinned calendar tab to see the rest of your day.", keywords: ["hover"] },
        timeToNext: {
          title: "Show time to next meeting",
          description: "A countdown badge on the pinned calendar tab before a meeting, and a red Now while it runs. Right-click the tab to hide Now for that meeting.",
          keywords: ["countdown", "badge", "now", "dismiss"],
        },
        countdownLead: { title: "Start countdown", description: "How long before a meeting the badge appears.", keywords: ["countdown", "badge", "minutes", "lead time", "next meeting"] },
      },
    },
    {
      section: "Meetings",
      rows: {
        autoGroup: {
          title: "Automatically group tabs for meetings",
          description: "Joining a call makes a tab group for it; links you open from the meeting join the group.",
          keywords: ["zoom", "meet", "call", "tab groups"],
        },
      },
    },
  ],
  engines: [
    {
      section: "Default engine",
      rows: {
        defaultEngine: {
          title: "Open pages in",
          description: "New pages open in this engine unless a website rule says otherwise.",
          keywords: ["engine", "webkit", "chromium", "safari", "drm", "netflix", "fairplay", "widevine"],
        },
        recommendedDefault: {
          title: "Use Recommended Default",
          description: "Chromium runs extensions and the ad blocker. Sites that need protected video can still open in WebKit.",
          keywords: ["reset", "recommended", "chromium"],
        },
        protectedVideo: {
          title: "Open streaming sites in WebKit",
          description: "Netflix, Disney+, Max, Prime Video, Hulu, Apple TV+, Spotify and other sites whose video is protected open in WebKit, which plays it. A website rule wins.",
          keywords: ["drm", "netflix", "disney", "hbo", "max", "prime video", "hulu", "spotify", "apple tv", "fairplay", "widevine", "streaming", "tencent video", "v.qq.com"],
        },
      },
    },
    {
      section: "Website rules",
      rows: {
        websiteRules: {
          title: "Website rules",
          description: "Sites that always open in a chosen engine. Links opened from a page stay on that page's engine.",
          keywords: ["opens in", "site engine", "rule", "webkit", "chromium"],
        },
      },
    },
    {
      section: "How engines differ",
      rows: {
        separateData: {
          title: "Separate sign-ins",
          description: "Each engine keeps its own cookies and site data in every profile. Spaces, tabs, history and settings are shared.",
          keywords: ["cookies", "site data", "sign in", "logged out"],
        },
        chromiumOnly: {
          title: "Extensions and ad blocking are Chromium only",
          description: "WebKit pages run without extensions or the ad blocker for now.",
          keywords: ["extensions", "ad blocker", "ublock", "content blocker"],
        },
        passkeys: {
          title: "Passkeys",
          description: "WebKit pages can't use passkeys until Apple grants Ardia its browser passkey entitlement. Sign in with a passkey in Chromium meanwhile.",
          keywords: ["passkey", "webauthn", "icloud keychain", "passwords app", "security key"],
        },
      },
    },
  ],
  advanced: [
    {
      section: "Browsing",
      rows: {
        showFullUrl: { title: "Show full URL in the address bar", description: "Instead of the site alone.", keywords: ["address", "url", "https"] },
        warnMovingTabs: { title: "Warn before moving tabs between profiles", description: "Some site data doesn't come along.", keywords: ["confirm"] },
        bookmarksImport: { title: "Show the Import bookmarks button", description: "On an empty bookmarks bar.", keywords: ["bookmarks bar"] },
      },
    },
    { section: "Performance", rows: { batterySaver: { title: "Battery Saver", keywords: ["energy", "low power mode", "performance", "power"] } } },
    {
      section: "Data",
      rows: {
        history: { title: "History", description: "Every page you visited, by day.", keywords: ["browsing history"] },
        downloads: { title: "Downloads", description: "Files you downloaded, with where they're saved.", keywords: ["files"] },
      },
    },
    {
      section: "Command line",
      rows: {
        cliControl: { title: "Let the ardia command control Ardia", keywords: ["cli", "terminal", "devtools", "automation", "remote debugging"] },
        cliInstall: { title: "The ardia command", keywords: ["cli", "terminal", "install"] },
      },
    },
    {
      section: "Web engine",
      rows: {
        chromium: { title: "Chromium", keywords: ["engine", "version", "ardiacore"] },
        widevine: { title: "Widevine (protected video)", keywords: ["drm", "netflix", "disney", "spotify"] },
      },
    },
    {
      section: "Source and licenses",
      rows: {
        source: { title: "Source code", description: "Ardia is open source under the Apache License 2.0.", keywords: ["github", "open source"] },
        licenses: { title: "Licenses", description: "Every open-source part of the engine, with its copyright and license.", keywords: ["credits", "legal"] },
      },
    },
  ],
};
