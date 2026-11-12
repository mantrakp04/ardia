import { APP, type SettingSection, type SettingsEnv } from "./types";
import type { SettingsPane } from "../../../state/settings/settingsWindows";

const inSidebar = (_: unknown, env: SettingsEnv) => !env.top;

export const generalRows = {
  general: [
    {
      section: "General",
      rows: {
        defaultBrowser: { title: "Default browser", description: `Make ${APP} your default browser.`, keywords: ["default", "set as default", "links"] },
        redoSetup: {
          title: `Set up ${APP} again`,
          description: "Walk through import, look and layout again, starting from your current settings.",
          keywords: ["onboarding", "setup", "redo", "welcome", "start over", "walkthrough", "first run"],
        },
        openAtLogin: { title: `Open ${APP} at login`, keywords: ["startup", "launch", "login items", "boot"] },
        warnBeforeQuitting: { advanced: true, title: "Warn before quitting", description: `Asks before ${APP} quits with ⌘Q.`, keywords: ["quit", "confirm", "cmd q"] },
        warnBeforeClosingWindow: {
          advanced: true,
          title: "Warn before closing a window with multiple tabs",
          description: "Asks before ⇧⌘W or the close button closes its tabs.",
          keywords: ["close window", "confirm"],
        },
        openLinksInLittleArdia: {
          title: "Open links from other apps in Little Ardia",
          keywords: ["little ardia", "little arc", "arc", "little window", "small window", "mini window", "external links", "links from other apps", "open links", "discord", "slack", "mail", "messages"],
        },
        littleArdiaOpensNewTabLinks: {
          title: "Keep new-tab links inside a Little Ardia window",
          description: "For links clicked in a Little Ardia window: a link that would open a new tab loads right there instead of in a tab of the main window. ⌘-click still opens it behind. Links in the main window follow Settings › Tabs › Open new-tab links in.",
          keywords: ["little ardia", "target blank", "new tab", "links"],
        },
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
      rows: { commandBarPreference: { advanced: true, title: "When input looks like a website", keywords: ["omnibox", "address", "url", "search", "website first"] } },
    },
    {
      section: "Downloads",
      rows: {
        downloadsFolder: { title: "Downloads folder", description: "Where downloaded files are saved.", keywords: ["download location", "save to", "path", "folder"] },
        askWhereToSave: { title: "Ask where to save each file", keywords: ["download location", "save as", "prompt", "choose folder"] },
        downloadsAllProfiles: {
          advanced: true,
          title: "Use these settings for every profile",
          description: "Gives every profile this folder and choice.",
          keywords: ["all profiles", "global", "download location"],
        },
      },
    },
    {
      section: "Updates",
      rows: {
        updateChecks: { advanced: true, title: "Check for updates automatically", keywords: ["update", "sparkle"] },
        autoUpdate: { advanced: true, title: `Automatically update ${APP}`, description: "Downloads updates in the background and installs them the next time it restarts.", keywords: ["update", "install"] },
        updateChannel: { title: "Update channel", description: "Nightly gets every fix first. Switching back to Stable never downgrades.", keywords: ["nightly", "stable", "beta"] },
        checkNow: { title: "Check for updates now", keywords: ["version", "update", "about"] },
      },
    },
    {
      section: "Import and Export",
      rows: {
        importBrowser: {
          title: "Import from another browser",
          description: "Bookmarks, history, passwords, tabs and Arc spaces from Chrome, Arc, Safari, Firefox and more.",
          keywords: ["migrate", "switch", "transfer"],
        },
        exportBookmarks: {
          title: "Export bookmarks",
          description: "To an HTML file that Chrome, Safari, Firefox and every other browser can import.",
          keywords: ["backup", "html", "netscape", "bookmarks.html", "save bookmarks", "transfer"],
        },
        setupCode: {
          advanced: true,
          title: "Apply a setup code",
          description: "Paste the code from the demo on ardia.dev to bring over the layout, look and pinned apps you picked there.",
          keywords: ["setup code", "demo", "ardia.dev", "preset", "arc", "layout"],
        },
      },
    },
  ],
  profiles: [
    { section: "New windows open with", rows: { defaultProfile: { title: "Default profile", description: "Used for new windows. Links from other apps open in the profile you used last.", keywords: ["new window"] } } },
    {
      section: "Shared data",
      rows: {
        shareTopApps: {
          title: "Share Top Apps",
          description:
            "Profiles that share browsing data can show the same Top Apps, each one a single page you pick up where you left it in any of them. Pick which ones take part. A profile with its own data keeps its own Top Apps, since its logins and cookies are separate.",
          keywords: ["pinned tabs", "favorites", "essentials", "spaces", "shared"],
        },
      },
    },
    {
      section: "Profile switcher",
      rows: {
        switcherIcons: {
          title: "Show profile icons instead of dots",
          description: "As in Arc: the switcher at the bottom of the sidebar shows each profile's symbol or emoji, and a profile without one keeps its dot. Right-click the switcher to pick an icon.",
          keywords: ["spaces", "space icons", "profile dots", "switcher", "emoji", "symbol", "sidebar footer", "arc"],
        },
      },
    },
    { section: "Profiles", rows: { list: { title: "Profiles", description: "Drag to reorder. ⌃1–⌃9 switch to the first nine.", keywords: ["create profile", "new profile", "delete profile", "reorder", "work", "personal"] } } },
  ],
  sync: [
    {
      section: "Sync",
      rows: {
        sync: { title: "Sync", description: "Sync your profiles, bookmarks, history, tabs, passwords, extensions and settings across your Macs.", keywords: ["icloud", "recovery phrase", "devices", "turn on sync", "end to end", "encrypted"] },
        folder: { advanced: true, title: "Sync folder", keywords: ["icloud drive", "dropbox", "folder"] },
      },
    },
  ],
  tabs: [
    { section: "Tab layout", rows: { layout: { title: "Tab layout", description: "In the sidebar or across the top of the window.", keywords: ["vertical tabs", "horizontal tabs", "top tabs", "sidebar"] } } },
    {
      section: "Tab layout",
      rows: {
        autoHideTabs: {
          title: "Auto-hide tabs",
          description: "In every window, the tabs slide out of view and come back when you move the pointer to the window's edge. ⌘S and View › Auto-Hide Tabs flip this same switch.",
          keywords: ["hide tabs", "hide sidebar", "show sidebar", "toggle sidebar", "hide tab bar", "tab strip", "top tabs", "focus mode", "full screen", "zen"],
        },
        sidebarSide: {
          title: "Sidebar position",
          description: "On the left, as in Dia, or on the right, as in Arc. The window buttons stay at the top left.",
          keywords: ["right", "left", "side", "position", "flip", "mirror", "sidebar on the right", "right sidebar", "arc"],
          shown: inSidebar,
        },
        hideToolbarWhileScrolling: {
          title: "Hide toolbar while scrolling",
          description: "Scrolling down tucks the toolbar into a thin strip with the site's name. Scroll up, or click the strip, to bring it back. Your tabs stay put: hiding them is Auto-hide tabs.",
          keywords: ["auto hide toolbar", "address bar hides", "collapse", "compact", "scroll"],
        },
        showSidebarButton: { advanced: true, title: "Show the Hide Tabs button", description: "The button at the toolbar's leading edge. Auto-hide tabs, ⌘S and View › Auto-Hide Tabs still hide and show the tabs.", keywords: ["toggle sidebar", "sidebar button", "hide tabs button"] },
        showClearButton: {
          advanced: true,
          title: "Show Clear button",
          description: "The ↓ Clear between your pinned tabs and your tabs. ⇧⌘K and File › Close All Tabs still clear them.",
          keywords: ["clear unpinned tabs", "close all tabs", "clear today", "divider", "arc"],
          shown: inSidebar,
        },
        balancedTopApps: {
          advanced: true,
          title: "Grow Top Apps as the sidebar widens",
          description: "As in Arc: up to four tiles across in balanced rows, and a wider sidebar makes them larger. Off, as in Dia, each row fills with as many tiles as fit.",
          keywords: ["pinned tiles", "favorites", "grid", "columns", "rows", "arc"],
          shown: inSidebar,
        },
        showUnreadCounts: {
          title: "Show unread counts on tabs",
          description: "A notification badge with the unread count or dot a site like Gmail or Slack puts in its title, at the end of its tab. Off by default. Once on, hide it for one site: right-click its tab and choose Hide Unread Count, or use Site Controls.",
          keywords: ["unread", "badge", "badges", "bubble", "bubbles", "count", "notification", "notifications", "notis", "dot", "red", "gmail", "inbox", "messages", "arc"],
        },
        showTopAppBadges: {
          title: "Show tab status on Top Apps",
          description: "A Top App's tile shows a speaker while its tab plays or is muted, a mark while it is in Picture in Picture, and its unread count when unread counts are on. Off, as in Dia, a tile shows only the site's icon.",
          keywords: ["pinned tiles", "favorites", "badges", "indicators", "unread count", "speaker", "audio", "muted", "playing", "clean", "dia"],
        },
        fadeUnloadedTabs: {
          advanced: true,
          title: "Fade icons of unloaded tabs",
          description: "A tab whose page isn't loaded, like a closed pinned tab or one restored after a relaunch, shows its icon faded, as sleeping tabs do. Clicking it loads the page.",
          keywords: ["unloaded", "asleep", "sleeping", "discarded", "dim", "grey", "gray", "inactive", "pinned", "closed"],
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
        newTabPosition: {
          title: "Add new tabs",
          description: "Where ⌘T and + New Tab put the new tab. Next to the current tab, it joins that tab's group (from a pinned tab, it goes first in the list), and closing it brings you back. Links open next to their page either way.",
          keywords: ["new tab position", "next to current tab", "after current tab", "beside", "right of", "below", "adjacent", "end", "left", "top", "bottom", "order", "cmd t"],
        },
        newTabButtonPosition: {
          advanced: true,
          title: "New Tab button",
          description: "Where + New Tab sits in the sidebar, whatever Add new tabs says. At the top it stays above your tabs and scrolls with them; at the bottom it follows your last tab and stays at the sidebar's bottom edge once the tabs fill it.",
          keywords: ["new tab button", "plus", "+", "top", "bottom", "sticky", "docked", "position"],
          shown: inSidebar,
        },
        shareTabsAcrossWindows: {
          title: "Share tabs across windows",
          description: "Every window of a profile lists the same tabs, as in Arc. A tab is live in one window at a time: selecting it in another brings it there, and the first window shows it greyed until you click it. Each window keeps its own selected tab.",
          keywords: ["arc", "multiple windows", "same tabs", "sync windows", "shared sidebar", "unpinned"],
        },
        warnBeforeClosingLastTab: { advanced: true, title: "Warn before closing last tab in a Profile", keywords: ["confirm", "close tab"] },
        tabReorderHaptics: { advanced: true, title: "Haptic feedback when reordering tabs", keywords: ["trackpad", "vibration", "drag"] },
        extendWebsiteColor: { title: "Extend website color into tab bar", keywords: ["theme color", "tint", "colour"] },
        sidebarMediaControls: {
          advanced: true,
          title: "Show media controls in the sidebar",
          description: "When a tab you're not looking at plays sound, a player appears at the bottom of the sidebar. Pinned tabs that are playing show one when you hover them.",
          keywords: ["music", "player", "audio", "now playing"],
        },
        autoPictureInPicture: {
          advanced: true,
          title: "Automatic Picture in Picture",
          description: "A video or call you're watching pops out when you switch tabs or leave the window, and returns when you come back.",
          keywords: ["pip", "video", "floating", "mini player"],
        },
        videoUpscaling: {
          advanced: true,
          title: "Video upscaling",
          description: "Sharpens low-resolution videos shown larger than they are, on Apple silicon. Only in the tab you're watching, never in the background, in Low Power Mode or when the Mac runs hot.",
          keywords: ["super resolution", "sharpen", "video quality"],
        },
      },
    },
    {
      section: "Links",
      rows: {
        peekLinksToOtherSites: {
          title: "Open a Peek window when clicking on links to other sites",
          description: "Only from Top Apps and pinned tabs, however the page opens the link, through a redirect such as Gmail's included. Links on the same site, ⌘-clicks, downloads and sign-in pop-ups work as before.",
          keywords: ["peek", "preview", "external links", "other sites", "pinned", "pinned tabs", "top apps", "favorites", "glance", "arc", "zen", "gmail", "target blank"],
        },
        newTabLinksOpenIn: {
          title: "Open new-tab links in",
          description: "Where a link that would open a new tab goes when you click it in a tab. ⌘-click still opens a tab behind, and sign-in pop-ups stay windows. Links from other apps follow Settings › General › Open links from other apps in Little Ardia.",
          keywords: ["peek", "new tab", "target blank", "links", "preview", "open links"],
        },
        peekModifier: {
          advanced: true,
          title: "Peek a link with",
          description: "Opens the link in a preview over the page. Open as Tab or Split View keeps it; Esc closes it.",
          keywords: ["peek", "preview", "shift click", "option click", "arc"],
        },
        splitLinkModifier: {
          advanced: true,
          title: "Open a link in split view with",
          description: "Opens the link in a pane beside the page. ⌥⌘-click splits too, and so does ⌥⇧-click when ⌥-click is chosen. A link that downloads still downloads.",
          keywords: ["split view", "split screen", "side by side", "option click", "alt click", "option shift click", "download", "dia"],
        },
      },
    },
    {
      section: "Tab groups",
      rows: {
        warnBeforeClosingTabGroup: {
          advanced: true,
          title: "Warn before closing a tab group",
          description: "Asks before Close Group closes a group and its tabs. A pinned group's − unloads its tabs instead, and keeps the group.",
          keywords: ["confirm", "close group", "folder", "accidentally"],
        },
        cmdClickCreatesTabGroup: { advanced: true, title: "⌘-clicking links creates tab groups", keywords: ["command click", "cmd click"] },
        optShiftClickOpensInGroup: {
          advanced: true,
          title: "⌥⇧-click opens tab in group",
          description: "⌥⇧-click a tab to open it in a group with the current tab. (⌥⇧-clicking a link opens it in a split.)",
          keywords: ["option shift click", "split"],
        },
        dragToGroupInTopStrip: {
          shown: (_, env) => env.top,
          title: "Drag a tab onto another to group them",
          description: "With tabs across the top, dropping a tab on another makes a group, and dropping it on a group adds it. Off, dragging only reorders.",
          keywords: ["drag", "drop", "group", "top tab strip", "horizontal tabs", "reorder"],
        },
        autoGroupMeetingTabs: { advanced: true, title: "Automatically group tabs for meetings", keywords: ["calendar", "zoom", "meet", "call"] },
      },
    },
    {
      section: "Clean up",
      rows: {
        cleanUp: {
          title: "Clean up tabs I haven't used in",
          description: "Closes tabs you haven't used (and duplicates) automatically, like the tab menu's Clean Up Daily.",
          keywords: ["archive", "auto close", "inactive tabs", "duplicates", "custom", "minutes"],
        },
      },
    },
  ],
} satisfies Pick<Record<SettingsPane, SettingSection[]>, "general" | "profiles" | "sync" | "tabs">;
