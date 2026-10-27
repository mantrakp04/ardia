# Onboarding redesign: "Arc brain or Dia brain?"

Approved by the owner on 2026-10-24, with one addition: every option is animated, so you see what it does
instead of reading about it.

## Idea

Ardia is Dia's polish with Arc's sidebar, and many settings already say "as in Arc" or "as in Dia". Onboarding
asks once which browser feels like home, uses the answer to fill in a preset, and then shows this-or-that cards.
Each card has a small animated illustration that plays its demo. The panel on the right is a mock window that
reflects every choice so far and animates from one state to the next.

## Flow

| # | Screen | Choices |
|---|---|---|
| 1 | Intro | unchanged |
| 2 | Where are you coming from? | Arc · Dia · Chrome · Safari · Firefox · Brave/Edge · Starting fresh. Browsers found on this Mac come first ("Found on this Mac"). Picking one sets that browser's preset (see Presets) and, unless it's "Starting fresh", offers the import for that browser, which runs while the next screens are shown. |
| 3 | Layout | Tabs: Sidebar / Top · Address bar: Toolbar / Sidebar (hidden with top tabs) · ⌘L: Under the address / Centred. A tag shows "Arc-style", "Dia-style" or "Your mix". |
| 4 | Tabs | ⌘T: New Tab page / Command bar · New tabs: Bottom / Top · Old tabs: Keep / Tidy after 12 h, 1 day, 1 week · On quit: Restore / Start fresh · Windows: Separate / Shared tabs. More options: Top Apps grid, peek modifier, ⌘Z reopens closed tab, ⌘-click tab groups. |
| 5 | Look | Theme color · Auto / Light / Dark · Website color in the tab bar on / off. More options: app icon, hide toolbar while scrolling, bookmarks bar. |
| 6 | Search & privacy | Search engine tiles · Typing a word: Website first / Search first · Block ads, trackers, cookie banners · Crash reports (today's receipt). |
| 7 | Pin your apps | today's step, preselected from the imported history once the import has finished |
| 8 | Make it home | Default browser (7-day trial), Dock, open at login, links from other apps in Little Ardia / a tab |
| 9 | Outro | postcard listing what you picked · Get Started / Take the Tour |

Every screen has Skip, which keeps the preset, and the progress dots. Going back keeps your choices. The `ardia`
CLI step leaves onboarding and stays in Settings › Advanced.

## Presets

Every browser on the "Where are you coming from?" screen has its own preset (`PRESETS` in
`state/onboarding/onboarding.ts`), so each screen starts out the way that browser behaves. "Starting fresh" keeps
Ardia's defaults except where its column says otherwise. Chrome, Firefox, Safari, Brave and Edge share one classic-tabs base.

Picking a browser applies its whole preset when you press Continue and skips every question the preset answers, so
the flow is Source → Color → Crash reports → Pins → Default browser → Outro (6 steps). Everything stays in
Settings. "Starting fresh" or skipping the Source screen keeps the full questionnaire.

| Setting | Arc | Dia | Zen | Chrome | Firefox | Safari | Brave | Edge | Starting fresh |
|---|---|---|---|---|---|---|---|---|---|
| Tabs (`tabLayout`) | sidebar | sidebar | sidebar | top | top | top | top | top | sidebar |
| Address bar (`addressBar`) | sidebar | toolbar | sidebar | toolbar | toolbar | toolbar | toolbar | toolbar | sidebar |
| ⌘L (`commandBarPlacement`) | centred | field | centred | field | field | field | field | field | centred |
| ⌘T (`newTabOpens`) | commandBar | page | commandBar | page | page | page | page | page | page |
| New tabs (`newTabPosition`, `newTabButtonPosition`) | top | bottom | top | bottom | bottom | bottom | bottom | bottom | below the current tab |
| Old tabs (`cleanUpInactiveTabsAfterHours`) | 12 h | keep | keep | keep | keep | keep | keep | keep | keep |
| On quit (`restoreSession`) | restore | restore | restore | restore | restore | restore | restore | restore | restore |
| Windows (`shareTabsAcrossWindows`) | shared | separate | separate | separate | separate | separate | separate | separate | separate |
| Top Apps grow (`balancedTopApps`) | on | off | on | off | off | off | off | off | off |
| Peek (`peekModifier`) | ⇧-click | ⇧-click | ⌥-click | ⌥-click | ⌥-click | ⌥-click | ⌥-click | ⌥-click | ⇧-click |
| ⌘Z reopens tab (`undoReopensClosedTab`) | on | off | off | off | off | off | off | off | off |
| ⌘-click makes a group (`cmdClickCreatesTabGroup`) | off | on | off | off | off | off | off | off | on |
| Appearance (`appearance`) | auto | auto | auto | auto | auto | auto | auto | auto | auto |
| Site color in tab bar (`extendWebsiteColor`) | off | on | off | off | off | on | off | off | on |
| Hide toolbar while scrolling (`hideToolbarWhileScrolling`) | on | on | off | off | off | off | off | off | on |
| Bookmarks bar (`bookmarksBar`) | never | never | never | New Tab | New Tab | never | New Tab | New Tab | never |
| Search engine (`searchEngine`) | Google | Google | Google | Google | Google | Google | Brave Search | Bing | Google |
| Typing a word (`commandBarPreference`) | website | website | search | search | search | search | search | search | website |
| Links from other apps (`openLinksInLittleArdia`) | Little Ardia | Little Ardia | tab | tab | tab | tab | tab | tab | Little Ardia |

Deliberate departures from the source browser:

- On quit always restores. Chrome, Brave and Edge open a blank New Tab page by default, but losing your tabs on the
  first quit is a bad surprise.
- Peek uses ⌥-click for browsers without peek. Their ⇧-click opens a new window (Chrome, Edge, Brave, Firefox) or adds
  to the Reading List (Safari), and ⌥-click only downloads the link, which hardly anyone does on purpose.
  Zen's Glance is ⌥-click too.

The Layout screen's tag names the chosen browser when the layout still matches its preset ("Chrome-style"), then
Arc or Dia when it matches theirs, otherwise "Your mix". Setup codes store the preset as its index in
`["arc", "dia", "chrome", "safari", "firefox", "zen", "brave", "edge", "fresh"]`, so older codes still read.

## Animation rules

- A card's demo plays once when its screen appears (staggered), again on hover, and again when it's selected.
  Nothing loops forever, and nothing animates on a screen that isn't shown.
- Use short, eased motion in the style of Dia's onboarding: 160–400 ms per move, ease-out, a demo of at most
  about 1.6 s.
- The mock window animates between states (the sidebar slides away for top tabs, the address field moves to
  the sidebar, the command bar drops in centred) instead of jumping.

## Choices that stay in Settings

Haptics, meeting tab groups, calendar and live folders, sync, profiles, passwords and autofill, shortcuts,
downloads, site permissions, the CLI, update channel, battery saver, PiP, video upscaling, media controls, and
the warn-before toggles.
