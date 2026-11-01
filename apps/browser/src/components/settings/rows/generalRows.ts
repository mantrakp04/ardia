import { APP, type SettingSection, type SettingsEnv } from "./types";
import type { SettingsPane } from "../../../state/settings/settingsWindows";

const inSidebar = (_: unknown, env: SettingsEnv) => !env.top;

export const generalRows = {
  general: [
    {
      section: "General",
      rows: {
        defaultBrowser: { title: "Default browser", description: `Make ${APP} your default browser.`, keywords: ["default", "set as default", "links"] },
        openAtLogin: { title: `Open ${APP} at login`, keywords: ["startup", "launch", "login items", "boot"] },
        warnBeforeQuitting: { advanced: true, title: "Warn before quitting", description: `Asks before ${APP} quits with ⌘Q.`, keywords: ["quit", "confirm", "cmd q"] },
        warnBeforeClosingWindow: {
          advanced: true,
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
        hideToolbarWhileScrolling: {
          title: "Hide toolbar while scrolling",
          description: "Scrolling down tucks the toolbar into a thin strip with the site's name. Scroll up, or click the strip, to bring it back.",
          keywords: ["auto hide", "compact"],
        },
        showSidebarButton: { advanced: true, title: "Show sidebar button", description: "⌘S and View › Auto-Hide Tabs still hide and show the sidebar.", keywords: ["toggle sidebar"], shown: inSidebar },
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
          description: "This only affects Top Apps and pinned tabs. Links on the same site, ⌘-clicks and links that open a new tab or download work as before.",
          keywords: ["peek", "preview", "external links", "other sites", "pinned", "pinned tabs", "top apps", "favorites", "glance", "arc", "zen"],
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
  appearance: [
    {
      section: "Appearance Theme",
      rows: {
        theme: { title: "Appearance Theme", description: "Also in View › Appearance. Incognito windows are always dark.", keywords: ["dark mode", "light mode", "automatic", "night", "system"] },
        spacesFollowAppearance: {
          advanced: true,
          title: "Profile themes follow this appearance",
          description: "Every profile goes light or dark with this choice, even when its theme (like one imported from an Arc space) says Light. In dark mode a light theme's colours are darkened so white text reads.",
          keywords: ["space", "profile theme", "arc theme", "follow system"],
        },
      },
    },
    {
      section: "Interface Style",
      rows: {
        interfaceStyle: {
          title: "Interface style",
          description: "Glass draws the pinned tiles, fields, buttons, Downloads and the site controls panel in macOS Liquid Glass. Classic keeps them flat, like Dia.",
          keywords: ["liquid glass", "glass", "classic", "flat", "translucent", "transparency", "glow", "frosted"],
          shown: (_, env) => !!env.glass,
        },
        glassTintWithTheme: {
          title: "Tint glass with the profile colour",
          description: "Off, the glass stays neutral grey whatever the profile's colour.",
          keywords: ["liquid glass", "tint", "colour", "color", "profile colour", "theme"],
          shown: (s, env) => !!env.glass && s.interfaceStyle === "glass",
        },
        glassTintAmount: {
          title: "Tint amount",
          description: "How much of the profile colour the glass takes, from a hint to fully coloured.",
          keywords: ["liquid glass", "tint", "strength", "intensity", "colour", "color", "glossy"],
          shown: (s, env) => !!env.glass && s.interfaceStyle === "glass" && s.glassTintWithTheme,
        },
      },
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
        compactToolbar: {
          title: "Compact toolbar",
          description: "A 28 pt toolbar instead of Dia's 41 pt, so the page gets more height and a 16:9 video can fill a maximized window. For the address bar in the toolbar and for tabs at the top.",
          keywords: ["toolbar height", "smaller toolbar", "thin toolbar", "slim", "dense", "helium", "video", "16:9", "black bars", "url bar"],
        },
      },
    },
    {
      section: "Bookmarks Bar",
      rows: {
        bookmarksBar: {
          title: "Show bookmarks bar",
          description: "Below the toolbar. Also in View › Show Bookmarks Bar, ⇧⌘B.",
          keywords: ["bookmarks bar", "favorites bar", "favourites bar", "toolbar", "hide bookmarks", "show bookmarks"],
        },
        bookmarksBarSize: {
          title: "Size",
          description: "Large makes the bar, its icons and its text bigger, and its folder menus roomier.",
          keywords: ["bookmarks bar", "bigger", "larger", "large", "small", "text size", "icon size", "readability", "favorites bar"],
        },
      },
    },
    {
      section: "Selected Tab",
      rows: {
        selectedTabGlow: {
          advanced: true,
          title: "Glow around the selected tab",
          description: "The soft light around the selected tab in the sidebar. Full is Dia's.",
          keywords: ["glow", "shadow", "halo", "highlight", "selected tab", "active tab"],
        },
      },
    },
    {
      section: "Scroll Bars",
      rows: {
        pageScrollBars: {
          advanced: true,
          title: "Scroll bars",
          description: "Follow macOS uses System Settings › Appearance › Show scroll bars. Thin shows slim scroll bars over the page only while you scroll, even with a mouse.",
          keywords: ["scrollbar", "scroll bar", "overlay", "thin", "mouse", "trackpad"],
        },
      },
    },
    { section: "App Icon", rows: { appIcon: { title: "App Icon", description: "Shown in the Dock and the app switcher. The Dock keeps it after you quit.", keywords: ["dock icon", "logo"] } } },
  ],
} satisfies Pick<Record<SettingsPane, SettingSection[]>, "general" | "profiles" | "sync" | "tabs" | "appearance">;
