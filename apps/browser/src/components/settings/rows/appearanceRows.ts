import { type SettingSection } from "./types";
import type { SettingsPane } from "../../../state/settings/settingsWindows";

export const appearanceRows = {
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
        adaptTextToColor: {
          title: "Adjust text to the colour",
          description: "Switch sidebar and tab text between light and dark so it stays readable on your colour. Only applies to custom colours.",
          keywords: ["contrast", "readable", "text colour", "text color", "white text", "black text", "custom colour", "theme", "arc"],
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
          keywords: ["tint", "colour", "color", "profile colour", "theme"],
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
          description: "In the centre, ⌘L shows it over the middle of the page, as in Arc. A click on the address always edits it where it is, and ⌘L opens in the centre whenever the address is out of sight.",
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
      section: "Bookmarks",
      rows: {
        showBookmarks: {
          title: "Show bookmarks",
          description: "Off hides the bookmark button, the bookmarks bar, the Bookmarks menu and every Bookmark command, and the address bar shows Copy URL instead. Your bookmarks stay, and importing still brings them in.",
          keywords: ["hide bookmarks", "show bookmarks", "bookmark button", "star", "bookmarks menu", "copy url", "arc", "no bookmarks"],
        },
        bookmarksBar: {
          title: "Show bookmarks bar",
          description: "Below the toolbar. Also in View › Show Bookmarks Bar, ⇧⌘B.",
          keywords: ["bookmarks bar", "favorites bar", "favourites bar", "toolbar", "hide bookmarks", "show bookmarks"],
          shown: (s) => s.showBookmarks,
        },
        bookmarksBarSize: {
          title: "Size",
          description: "Large makes the bar, its icons and its text bigger, and its folder menus roomier.",
          keywords: ["bookmarks bar", "bigger", "larger", "large", "small", "text size", "icon size", "readability", "favorites bar"],
          shown: (s) => s.showBookmarks,
        },
      },
    },
    {
      section: "Page Frame",
      rows: {
        borderlessMode: {
          title: "Borderless mode",
          description: "Remove the page frame and rounded corners. Turn off to restore your frame thickness.",
          keywords: ["border", "borderless", "edge to edge", "no borders", "frameless", "full bleed"],
        },
        pageFrame: {
          title: "Frame around the page",
          description: "The room between the page and the window's edges, the sidebar and split panes. At 0 the page goes edge to edge with square corners; 9 pt is the default.",
          keywords: ["border", "borderless", "edge to edge", "margin", "inset", "padding", "rounded corners", "corner radius", "frame", "gap", "full bleed", "arc", "compact"],
          shown: (s) => !s.borderlessMode,
        },
        pageFrameZeroInFullScreen: {
          title: "Zero in full screen",
          description: "In macOS full screen the page goes edge to edge with square corners, whatever the frame above is set to.",
          keywords: ["fullscreen", "full screen", "borderless", "edge to edge", "zero", "none", "frame", "inset", "margin"],
        },
        pageFrameZeroWhenTabsHidden: {
          title: "Zero in full screen when tabs are hidden",
          description: "In macOS full screen with Auto-Hide Tabs, the page goes edge to edge with square corners. Show the sidebar or top strip, or leave full screen, and the frame comes back.",
          keywords: ["auto hide", "autohide", "sidebar", "tabs hidden", "fullscreen", "full screen", "borderless", "edge to edge", "zero", "none", "frame", "inset", "margin"],
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
} satisfies Pick<Record<SettingsPane, SettingSection[]>, "appearance">;
