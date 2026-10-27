# Kill switches

A speed change people can feel ships behind a switch, so a release that turns out slow or broken on some Macs can be
backed out without another build. `apps/browser/src/platform/killSwitches.ts` is the registry; `apps/site/public/switches.json`
(served at `https://ardia.dev/switches.json`) says which are off.

## Rules

- **At most 8 switches live** (`MAX_SWITCHES`). `killSwitches.test.mjs` fails above 8, and for any switch past its
  `removeBy` date: delete the switch and its old path, or move the date and say why in the commit.
- Every switch is **on by default**, has an `owner` (an area) and an `about` line, and falls back to the behaviour from
  before the change when off, with a unit test of both paths.
- A switch is **`live`** when it's read where it's used (each call, never held in state), so a value that arrives mid-launch
  applies at once. Otherwise it's read once at launch and a change applies at the next one.
- Reads are synchronous (`switchOn(name)`) and never re-render anything.

## The file

```json
{ "version": 1, "switches": { "newTabPrewarm": false } }
```

Only names the app knows and booleans count; anything else is ignored. Leaving a switch out means on (the cache follows
the file, not the first answer). Editing the file is a site deploy (`pnpm -C apps/site run deploy`: an owner-approved
public action like any other).

## The request

Once a launch, after the first window, and only where the update check runs too (an updater that's set up, automatic
checks on: `killSwitchesLaunch.ts`). A plain GET of the static file: no cookies (`credentials: "omit"`), no headers of ours,
no query string, no ID, a 5 s timeout, 4 KB at most. The answer is cached in the data dir (`switches-cache.json`) and used
offline; a failed or odd answer leaves the cache as it was. The same file goes to everyone, so it can't tell one Mac from
another. Disclosed in Settings › What's Sent (“Even with sharing off”) and next to the update check in Settings › General
(`state/telemetry/copy.ts`, `switchFile`).

## For a bench or a test instance

`ARDIA_SWITCHES="newTabPrewarm=off,lazySidebarRows=off"` sets a launch's values over everything else, in every build.
`ArdiaLaunchConfig` parses it once; native code asks it (`switchOn:`, `experimentOn:`), JS through
`platform/launchConfig.ts`, and the engine gets it as `--ardia-switches` (the GPU process too). A test instance has no
updater, so it never fetches.

## The switches (see `SWITCHES` for owners and dates)

| Switch | Off means | Live |
|---|---|---|
| `newTabPrewarm` | a New Tab page's tab is made by Enter, as before the prewarm | yes |
| `lazySidebarRows` | a launch mounts 64 rows per page and every profile page at once | no |
| `updatePrewarm` | a staged update installs without the hidden first run, at quit or at once from Install and Relaunch (read natively: `UpdatePrewarm.swift`) | yes |
| `launchTab` | session.json keeps no launch hint and a launch claims nothing: the restored page loads once its window's content mounts, and the early window stays off | no |
| `focusedWindowFirst` | a launch opens every window at once, the focused one last | no |
| `sidebarSlide` | hiding or showing the sidebar jumps instead of sliding (it stays mounted either way); with the address bar in the sidebar, a hidden sidebar's bar moves to a toolbar on the card and the peek is Dia's | yes |
| `sidebarSlideLean` | every step of the slide lays the traffic lights out (AppKit then rewalks the window's views); read natively, once a launch: `ChromeWindows.swift` | no |
| `chromeBatterySaver` | Battery Saver is our sampler freezing busy background tabs over CDP instead of Chrome's own mode (`state/tabs/tabLifecycle.ts`) | no |

## Experiments (off by default; `EXPERIMENTS`)

A change still being tried, off for everyone until `ARDIA_SWITCHES` turns it on for a launch. Experiments have an owner
and a `removeBy` like the switches, don't count against the 8, and the site's switches.json can't name them.

| Experiment | On means |
|---|---|
| `beginFrameBridge` | while a shown tab waits for the display link's first callback, the GPU process sends up to 4 warm-up BeginFrames on the display's last vsync grid (`chromium-begin-frame-warm-up.patch`; engine, read in every process) |
| `serverWindowDrag` | the window server moves the window from our drag areas at once instead of waiting for mouseDown on the main thread (`ServerWindowDrag.swift`); `serverWindowDragAllOpen` also leaves every view in the titlebar band open to moves |
| `webkitSignIn` | moving a Chromium page to WebKit first copies the cookies that page's own address gets (HttpOnly included, partitioned ones left out) into the profile's WebKit store, so a cookie sign-in (Netflix, Spotify…) comes along; at most 1.5 s, then the move goes ahead either way (`state/engines/engineSignIn.ts`, `WebKitCookieImport.swift`) |

The environment-only switches of 2026-10-17 to 10-20 (`ARDIA_EARLY_WINDOW_FIRST`, `ARDIA_SCROLL_FULL_RATE`,
`ARDIA_WALLET_PASSES`, …) shipped their default in 0.2.40 and are gone with their other branch.

## Staged rollout

A release can also reach people in steps: `scripts/release.sh <version> --phased <seconds>` and the release skill's step 5b.
