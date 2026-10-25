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
| 2 | Where are you coming from? | Arc · Dia · Chrome · Safari · Firefox · Brave/Edge · Starting fresh. Browsers found on this Mac come first ("Found on this Mac"). Picking one sets the preset (Arc → Arc, otherwise Dia) and, unless it's "Starting fresh", offers the import for that browser, which runs while the next screens are shown. |
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

| | Dia | Arc |
|---|---|---|
| `addressBar` | toolbar | sidebar |
| `commandBarPlacement` | field | centred |
| `newTabOpens` | page | commandBar |
| `newTabPosition` | bottom | top |
| `balancedTopApps` | false | true |
| `shareTabsAcrossWindows` | false | true |
| `cleanUpInactiveTabsAfterHours` | null | 12 |
| `openLinksInLittleArdia` | true | true |

A preset fills an onboarding draft. A screen writes its keys with `updateSettings` when you press Continue, so
only the keys someone actually saw land in `chosen`. A skipped screen writes nothing, so later default changes
still reach people who never saw it.

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
