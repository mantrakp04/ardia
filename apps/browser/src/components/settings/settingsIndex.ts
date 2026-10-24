import { prepare, type Searchable } from "./searchMatch";
import type { SettingsPane } from "./windows";

export const PANES: { id: SettingsPane; title: string; icon: string }[] = [
  { id: "general", title: "General", icon: "gearshape" },
  { id: "profiles", title: "Profiles", icon: "person.2" },
  { id: "sync", title: "Sync", icon: "arrow.triangle.2.circlepath" },
  { id: "tabs", title: "Tabs", icon: "square.on.square" },
  { id: "appearance", title: "Appearance", icon: "circle.lefthalf.filled" },
  { id: "privacy", title: "Privacy & Security", icon: "hand.raised" },
  { id: "passwords", title: "Passwords", icon: "key" },
  { id: "autofill", title: "Autofill", icon: "creditcard" },
  { id: "extensions", title: "Extensions", icon: "puzzlepiece.extension" },
  { id: "search", title: "Search Engine", icon: "magnifyingglass" },
  { id: "shortcuts", title: "Keyboard Shortcuts", icon: "keyboard" },
  { id: "liveFolders", title: "Live Folders", icon: "dot.radiowaves.left.and.right" },
  { id: "calendar", title: "Calendar", icon: "calendar" },
  { id: "advanced", title: "Advanced", icon: "slider.horizontal.3" },
];

type Row = { title: string; description?: string; keywords?: string[] };
type Section = { section: string; rows: Record<string, Row> };

const APP = "Ardia";

const ROWS: Record<SettingsPane, Section[]> = {
  general: [
    {
      section: "General",
      rows: {
        defaultBrowser: { title: "Default browser", description: `Make ${APP} your default browser.`, keywords: ["default", "set as default", "links"] },
        openAtLogin: { title: `Open ${APP} at login`, keywords: ["startup", "launch", "login items", "boot"] },
        warnBeforeQuitting: { title: "Warn before quitting", description: `Asks before ${APP} quits with ⌘Q.`, keywords: ["quit", "confirm", "cmd q"] },
        warnBeforeClosingWindow: {
          title: "Warn before closing a window with multiple tabs",
          description: "Asks before ⇧⌘W or the close button closes its tabs.",
          keywords: ["close window", "confirm"],
        },
        openLinksFrom: { title: "Open links from other apps in", keywords: ["little ardia", "external links", "mini window", "discord", "slack", "mail"] },
      },
    },
    {
      section: `When quitting ${APP}:`,
      rows: {
        windowsAndTabs: {
          title: "Windows and tabs",
          description: "What you see the next time you open it. Closed windows stay in History › Recently Closed.",
          keywords: ["restore", "session", "reopen", "preserve tabs", "start fresh"],
        },
      },
    },
    {
      section: "Command bar",
      rows: { commandBarPreference: { title: "When input looks like a website", keywords: ["omnibox", "address", "url", "search", "website first"] } },
    },
    {
      section: "Downloads",
      rows: {
        downloadsFolder: { title: "Downloads folder", description: "Where downloaded files are saved.", keywords: ["download location", "save to", "path", "folder"] },
        askWhereToSave: { title: "Ask where to save each file", keywords: ["download location", "save as", "prompt", "choose folder"] },
        downloadsAllProfiles: {
          title: "Use these settings for every profile",
          description: "Gives every profile this folder and choice.",
          keywords: ["all profiles", "global", "download location"],
        },
      },
    },
    {
      section: "Updates",
      rows: {
        updateChecks: { title: "Check for updates automatically", keywords: ["update", "sparkle"] },
        autoUpdate: { title: `Automatically update ${APP}`, description: "Downloads updates in the background and installs them the next time it restarts.", keywords: ["update", "install"] },
        updateChannel: { title: "Update channel", description: "Nightly gets every fix first. Switching back to Stable never downgrades.", keywords: ["nightly", "stable", "beta"] },
        checkNow: { title: "Check for updates now", keywords: ["version", "update", "about"] },
      },
    },
    {
      section: "Import",
      rows: {
        importBrowser: {
          title: "Import from another browser",
          description: "Bookmarks, history, passwords, tabs and Arc spaces from Chrome, Arc, Safari, Firefox and more.",
          keywords: ["migrate", "switch", "transfer"],
        },
      },
    },
  ],
  profiles: [
    { section: "New windows open with", rows: { defaultProfile: { title: "Default profile", description: "Used for new windows. Links from other apps open in the profile you used last.", keywords: ["new window"] } } },
    { section: "Profiles", rows: { list: { title: "Profiles", description: "Drag to reorder. ⌃1–⌃9 switch to the first nine.", keywords: ["create profile", "new profile", "delete profile", "reorder", "work", "personal"] } } },
  ],
  sync: [
    {
      section: "Sync",
      rows: {
        sync: { title: "Sync", description: "Sync your profiles, bookmarks, history, tabs, passwords, extensions and settings across your Macs.", keywords: ["icloud", "recovery phrase", "devices", "turn on sync", "end to end", "encrypted"] },
        folder: { title: "Sync folder", keywords: ["icloud drive", "dropbox", "folder"] },
      },
    },
  ],
  tabs: [
    { section: "Tab layout", rows: { layout: { title: "Tab layout", description: "In the sidebar or across the top of the window.", keywords: ["vertical tabs", "horizontal tabs", "top tabs", "sidebar"] } } },
    {
      section: "Tab layout",
      rows: {
        hideToolbarWhileScrolling: {
          title: "Hide toolbar while scrolling",
          description: "Scrolling down tucks the toolbar into a thin strip with the site's name. Scroll up, or click the strip, to bring it back.",
          keywords: ["auto hide", "compact"],
        },
        showSidebarButton: { title: "Show sidebar button", description: "⌘S and View › Auto-Hide Tabs still hide and show the sidebar.", keywords: ["toggle sidebar"] },
        balancedTopApps: {
          title: "Grow Top Apps as the sidebar widens",
          description: "As in Arc: up to four tiles across in balanced rows, and a wider sidebar makes them larger. Off, as in Dia, each row fills with as many tiles as fit.",
          keywords: ["pinned tiles", "favorites", "grid", "columns", "rows", "arc"],
        },
      },
    },
    {
      section: "General",
      rows: {
        newTabOpens: {
          title: "New tab opens",
          description: "With Command Bar, ⌘T and New Tab open the command bar over the page, as in Arc. The tab appears when you pick a result; Esc leaves everything as it was.",
          keywords: ["new tab page", "command bar", "cmd t"],
        },
        newTabPosition: { title: "Add new tabs to the top", keywords: ["new tab position", "left", "bottom", "order"] },
        shareTabsAcrossWindows: {
          title: "Share tabs across windows",
          description: "Every window of a profile lists the same tabs, as in Arc. A tab is live in one window at a time: selecting it in another brings it there, and the first window shows it greyed until you click it. Each window keeps its own selected tab.",
          keywords: ["arc", "multiple windows", "same tabs", "sync windows", "shared sidebar", "unpinned"],
        },
        warnBeforeClosingLastTab: { title: "Warn before closing last tab in a Profile", keywords: ["confirm", "close tab"] },
        tabReorderHaptics: { title: "Haptic feedback when reordering tabs", keywords: ["trackpad", "vibration", "drag"] },
        extendWebsiteColor: { title: "Extend website color into tab bar", keywords: ["theme color", "tint", "colour"] },
        sidebarMediaControls: {
          title: "Show media controls in the sidebar",
          description: "When a tab you're not looking at plays sound, a player appears at the bottom of the sidebar. Pinned tabs that are playing show one when you hover them.",
          keywords: ["music", "player", "audio", "now playing"],
        },
        autoPictureInPicture: {
          title: "Automatic Picture in Picture",
          description: "A video or call you're watching pops out when you switch tabs or leave the window, and returns when you come back.",
          keywords: ["pip", "video", "floating", "mini player"],
        },
        videoUpscaling: {
          title: "Video upscaling",
          description: "Sharpens low-resolution videos shown larger than they are, on Apple silicon. Only in the tab you're watching, never in the background, in Low Power Mode or when the Mac runs hot.",
          keywords: ["super resolution", "sharpen", "video quality"],
        },
      },
    },
    {
      section: "Links",
      rows: {
        peekModifier: {
          title: "Peek a link with",
          description: "Opens the link in a preview over the page. Open as Tab or Split View keeps it; Esc closes it. ⌥⇧-click still opens a split.",
          keywords: ["peek", "preview", "shift click", "option click", "arc"],
        },
      },
    },
    {
      section: "Tab groups",
      rows: {
        cmdClickCreatesTabGroup: { title: "⌘-clicking links creates tab groups", keywords: ["command click", "cmd click"] },
        optShiftClickOpensInGroup: {
          title: "⌥⇧-click opens tab in group",
          description: "⌥⇧-click a tab to open it in a group with the current tab. (⌥⇧-clicking a link opens it in a split.)",
          keywords: ["option shift click", "split"],
        },
        autoGroupMeetingTabs: { title: "Automatically group tabs for meetings", keywords: ["calendar", "zoom", "meet", "call"] },
      },
    },
    {
      section: "Clean up",
      rows: {
        cleanUp: {
          title: "Clean up tabs I haven't used in",
          description: "Closes tabs you haven't used (and duplicates) automatically, like the tab menu's Clean Up Daily.",
          keywords: ["archive", "auto close", "inactive tabs", "duplicates"],
        },
      },
    },
  ],
  appearance: [
    {
      section: "Appearance Theme",
      rows: { theme: { title: "Appearance Theme", description: "Also in View › Appearance. Incognito windows are always dark.", keywords: ["dark mode", "light mode", "automatic", "night", "system"] } },
    },
    {
      section: "Address Bar",
      rows: {
        addressBar: { title: "Address Bar", description: "In the toolbar or in the sidebar.", keywords: ["url bar", "location bar", "toolbar"] },
        commandBarPlacement: {
          title: "⌘L opens the command bar",
          description: "In the centre, ⌘L and a click on the address show it over the middle of the page, as in Arc.",
          keywords: ["cmd l", "command bar", "centred", "centered", "arc", "url bar", "location bar"],
        },
      },
    },
    { section: "App Icon", rows: { appIcon: { title: "App Icon", description: "Shown in the Dock and the app switcher. The Dock keeps it after you quit.", keywords: ["dock icon", "logo"] } } },
  ],
  privacy: [
    {
      section: "Content blocking",
      rows: {
        contentBlocker: { title: "Blocker", keywords: ["ad blocker", "ublock origin", "adnauseam", "extension"] },
        blockAds: { title: "Block ads", keywords: ["ad blocker", "adblock", "ublock origin", "easylist"] },
        clickAds: {
          title: "Background ad clicking",
          description: "Included with AdNauseam for active obfuscation. Choose uBlock Origin for blocking without clicking.",
          keywords: ["adnauseam", "ad clicks", "obfuscation"],
        },
        blockTrackers: { title: "Block trackers", keywords: ["tracking", "easyprivacy", "fingerprinting"] },
        blockCookieBanners: { title: "Block cookie banners", keywords: ["cookies", "consent", "gdpr", "popups"] },
        filterLists: {
          title: "Advanced Settings",
          description: "Block common components found across the web by using additional rules and filters.",
          keywords: ["filter lists", "annoyances", "malware", "regional", "ad block settings"],
        },
      },
    },
    {
      section: "Site permissions",
      rows: {
        sitePermissions: {
          title: "Site permissions",
          description: "Pop-ups, camera, location and other permissions you've set for sites.",
          keywords: ["camera", "microphone", "location", "notifications", "popups", "cookies", "javascript", "clear site data", "website settings"],
        },
      },
    },
    { section: "Apps allowed to open links", rows: { appLinks: { title: "Apps allowed to open links", description: "Sites that open another app without asking first.", keywords: ["external apps", "protocol handlers", "zoom links"] } } },
    {
      section: "Crash reports and usage",
      rows: {
        shareDiagnostics: { title: "Share anonymous crash reports and usage stats", keywords: ["telemetry", "analytics", "diagnostics", "crash"] },
        whatsSent: { title: "What's Sent", description: "Every field, and what never leaves this Mac.", keywords: ["telemetry", "data collection"] },
      },
    },
  ],
  passwords: [
    {
      section: "Passwords",
      rows: {
        offerToSave: {
          title: "Offer to save and fill passwords",
          description: "Offers to save a login after you sign in, and suggests saved ones when you click a login field.",
          keywords: ["password manager", "logins", "credentials", "keychain"],
        },
        importPasswords: { title: "Import passwords", description: "From a CSV exported by Chrome, Safari, Firefox, 1Password, Bitwarden…", keywords: ["csv", "logins"] },
        exportPasswords: { title: "Export passwords", description: "To a CSV file. Anyone who can open the file can read your passwords.", keywords: ["csv", "backup", "logins"] },
        managerApps: { title: "Password manager apps", keywords: ["1password", "bitwarden", "keepassxc", "proton pass"] },
      },
    },
  ],
  autofill: [
    {
      section: "Autofill",
      rows: {
        addresses: { title: "Save and fill addresses", description: "Names, addresses, email addresses and phone numbers.", keywords: ["forms", "contact", "phone", "email"] },
        cards: { title: "Save and fill credit cards", description: "Filling in or showing a card number asks for Touch ID or your password.", keywords: ["payment", "debit card", "forms"] },
      },
    },
    { section: "Addresses", rows: { addressList: { title: "Addresses", keywords: ["add address", "saved addresses"] } } },
    { section: "Credit Cards", rows: { cardList: { title: "Credit Cards", keywords: ["add card", "saved cards", "payment"] } } },
  ],
  extensions: [
    { section: "Extensions", rows: { installed: { title: "Extensions", description: "Add features to Ardia with extensions from the Chrome Web Store. Each profile has its own.", keywords: ["add ons", "plugins", "installed"] } } },
    {
      section: "Add extensions",
      rows: {
        webStore: { title: "Chrome Web Store", description: "Browse the store; its Add to Ardia button installs here.", keywords: ["install extension"] },
        addLink: { title: "Add from a link", description: "Paste a Chrome Web Store link or extension ID.", keywords: ["install extension", "url"] },
        unpacked: { title: "Load unpacked extension", description: "For developers: load an extension folder with a manifest.json.", keywords: ["developer mode"] },
      },
    },
  ],
  search: [
    { section: "Default search engine", rows: { defaultEngine: { title: "Default search engine", description: "Used by the command bar and the New Tab page.", keywords: ["google", "duckduckgo", "bing", "kagi", "ecosia"] } } },
    {
      section: "Other search engines",
      rows: { otherEngines: { title: "Other search engines", description: "Type a shortcut and press Tab in the command bar to search a site directly.", keywords: ["custom search", "site search", "keyword"] } },
    },
    { section: "Suggestions", rows: { suggestions: { title: "Show search suggestions", description: "Sends what you type to your search engine to suggest searches.", keywords: ["autocomplete"] } } },
  ],
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
      rows: { folders: { title: "Live folders", description: "Live folders refresh every few minutes; items open as tabs that stay in the folder.", keywords: ["new live folder"] } },
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
        timeToNext: { title: "Show time to next meeting", description: "A badge on the pinned calendar tab within the hour before a meeting.", keywords: ["countdown", "badge"] },
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

export type SettingEntry = Searchable & { pane: SettingsPane };

const paneTitle = (pane: SettingsPane) => PANES.find((p) => p.id === pane)!.title;

export const SETTINGS: SettingEntry[] = PANES.flatMap(({ id: pane }) =>
  ROWS[pane].flatMap(({ section, rows }) =>
    Object.entries(rows).map(([key, row]) => ({ id: `${pane}.${key}`, pane, paneTitle: paneTitle(pane), section, ...row })),
  ),
);

const byId = new Map(SETTINGS.map((s) => [s.id, s]));

export function setting(id: string): SettingEntry {
  const entry = byId.get(id);
  if (!entry) throw new Error(`no setting ${id}`);
  return entry;
}

export const SETTINGS_INDEX = prepare(SETTINGS);
