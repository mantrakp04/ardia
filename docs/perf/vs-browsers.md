# Ardia against Dia, Helium and Chrome

A cross-browser benchmark for ardia.dev on the release gate's rows (docs/perf/0.2.36-to-0.2.37.md) that can be
measured the same way in any Chromium browser. Harness: `apps/browser/scripts/perf/xbench.mjs` (`--help`). Results:
`apps/site/src/data/bench.json` (written by `xbench.mjs report`).

## Results (2026-10-16)

Five rounds, interleaved and rotated. Each round has 2 launches of each kind and 1 session per browser. Values are the
median (min–max, n) over runs, measured with the Mac in normal use by the owner (see Method). Out dir:
`/tmp/ac-xbench/final`.

| Row | Ardia 0.2.37 | Dia 1.53.0 | Helium 0.19.2.1 | Google Chrome 155.0.8059.85 |
|---|---|---|---|---|
| Cold launch → page painted (link opened from another app) | 543 ms (513–817, n=10) | 2643 ms (2307–3076, n=10) | 527 ms (455–805, n=10) | **484 ms** (434–738, n=10) |
| Cold launch → window on screen | **358 ms** (329–590, n=10) | 2262 ms (2003–2547, n=10) | 499 ms (431–724, n=10) | 424 ms (405–681, n=10) |
| Cold launch → restored tab painted | 494 ms (475–805, n=10) | – (never, see below) | 508 ms (457–746, n=10) | **438 ms** (413–676, n=10) |
| New tab → first paint | 80 ms (71–81, n=5) | 89 ms (85–96, n=5) | 71 ms (63–75, n=5) | **54 ms** (46–63, n=5) |
| Tab switch → shown | 40 ms (33–40, n=5) | 24 ms (24–31, n=5) | 8.5 ms (8–33, n=5) | **8 ms** (7–8.5, n=5) |
| New window → first paint | – (no window, see below) | 144 ms (131–153, n=5) | **95 ms** (83–104, n=5) | 100 ms (83–103, n=5) |
| Memory, 1 tab | **290 MB** (273–291, n=5) | 480 MB (478–485, n=5) | 375 MB (372–378, n=5) | 370 MB (367–379, n=5) |
| Memory, 10 tabs | 763 MB (750–767, n=5) | 1273 MB (1113–1278, n=5) | 776 MB (773–804, n=5) | **692 MB** (690–700, n=5) |
| Memory, 20 tabs | 1183 MB (1171–1191, n=5) | 1822 MB (1602–1835, n=5) | 1125 MB (1124–1292, n=5) | **919 MB** (919–934, n=5) |
| Memory, back to 1 tab after 20 | **361 MB** (359–366, n=5) | 538 MB (535–552, n=5) | 415 MB (409–440, n=5) | 406 MB (402–416, n=5) |
| Idle CPU, 1 tab | 0.20 % (0.18–0.25, n=5) | 0.63 % (0.55–0.74, n=5) | 0.24 % (0.18–0.34, n=5) | 0.20 % (0.18–0.55, n=5) |
| Idle CPU, 20 tabs | 1.42 % (1.34–1.64, n=5) | 1.05 % (0.95–1.45, n=5) | 1.43 % (1.10–1.52, n=5) | **0.62 %** (0.58–1.34, n=5) |
| Idle wakeups, 1 tab | 6.9 /s (6.5–7.4, n=5) | 14.4 /s (13.5–19.9, n=5) | 6.5 /s (6.2–12.0, n=5) | 6.8 /s (6.4–7.3, n=5) |
| Idle wakeups, 20 tabs | 29.8 /s (29.1–31.7, n=5) | 38.7 /s (36.3–45.0, n=5) | 34.1 /s (26.8–42.4, n=5) | 30.9 /s (28.4–32.2, n=5) |

Bold is the best median. Ardia wins outright (ranges apart from every competitor) on memory at 1 tab and back to 1
tab, and its median is best on window on screen and idle wakeups at 20 tabs, with ranges overlapping. The rest are
listed with margins and diagnoses below.

Context, not a gate row (not in bench.json):

| | Ardia 0.2.37 | Dia 1.53.0 | Helium 0.19.2.1 | Chrome 155 |
|---|---|---|---|---|
| Download (DMG) | 187 MB | 854 MB | 115 MB (arm64) | 276 MB (universal) |
| App on disk | 446 MB | 1414 MB | 355 MB (arm64) | 758 MB (universal) |

### Where Ardia loses or ties, and why

Margins are against the best competitor; "apart" means the ranges don't overlap.

| Row | Ardia | Best | Margin | Verdict |
|---|---|---|---|---|
| Tab switch → shown | 40 ms | Chrome 8 ms | +32 ms (5×) | loses, apart; Helium 8.5 and Dia 24 also beat it |
| New tab → first paint | 80 ms | Chrome 54 ms | +26 ms | loses, apart; Helium 71 (ranges overlap) also better |
| Memory, 20 tabs | 1183 MB | Chrome 919 MB | +264 MB (+29 %) | loses, apart; Helium 1125 (overlapping) also better |
| Memory, 10 tabs | 763 MB | Chrome 692 MB | +71 MB (+10 %) | loses, apart |
| Idle CPU, 20 tabs | 1.42 % | Chrome 0.62 % | +0.80 points (2.3×) | loses; ranges touch at 1.34. Dia 1.05 also better; Helium ties |
| Cold launch → restored tab painted | 494 ms | Chrome 438 ms | +56 ms | loses on median, ranges overlap |
| Cold launch → page painted (link) | 543 ms | Chrome 484 ms | +59 ms | loses on median, ranges overlap; Helium 527 also better |
| Idle wakeups, 1 tab | 6.9 /s | Helium 6.5 /s | +0.4 /s | ties (overlap); Chrome 6.8 |
| Idle CPU, 1 tab | 0.20 % | Chrome 0.20 % | 0 | ties |
| New window → first paint | – | Helium 95 ms | – | not measurable: Ardia opens no window (below) |
| Download, on disk (context) | 187 / 446 MB | Helium 115 / 355 MB | +72 / +91 MB | loses |

**Tab switch (+32 ms).** Chrome activates a tab natively in a few milliseconds: 8 ms here is visibilitychange plus two
frames. In Ardia, `Target.activateTarget` changes Chrome's tab strip, then:
- Ardia's JS mirror (`state/tabs/chromeTabs.ts`) updates the store;
- React re-renders the window;
- the native view is swapped in and shown.

native-bench's own switch, which starts in the store, is 31–33 ms, so about 25 ms of the 40 is the JS and React
round trip, not Chrome. Every switch pays that before the page is shown (render-census.md: tab switch renders and
store fan-out).

Update (2026-10-17): the page is now shown natively as JS picks the tab (state/tabs/tabReveal.ts), and xbench reads 10–16 ms
against Helium's 8.5. A probe with xbench's method (CDP activate, then visibilitychange, then two rAFs) plus a
Chrome trace (viz, cc, begin_frame, scheduler) of 6 switches each:

| | Ardia | Helium |
|---|---|---|
| CDP activate to visibilitychange | 2 ms | 5 ms |
| display-link callbacks in the 20 ms before the show | 0 every time | 2, in 4 of 6 shows |
| first display-link callback after the show | 6.3–13.6 ms | 0.9–3.1 ms (9.6 when cold) |
| first BeginFrame's frame time | about +2 ms ("now") | 6 ms in the past |
| second BeginFrame arrives | +10.8 ms (median) | +2.4 ms |
| renderer frame sequence on show | starts again at 1 | continues |

Our pages live in our own NSViews, so each tab's view has its own compositor (`BrowserCompositorMac` in
HasOwnCompositor), recycled on hide and taken again on show: a new frame sink and begin-frame source each time, off
the vsync grid. More to the point, the display link is always stopped when the page is shown (it stops after 20
idle callbacks, about 170 ms, and nothing in Ardia wakes it first), and starting it costs one or two refreshes.
In Helium the switch first redraws Chrome's own tab strip on the window's compositor, which starts the link before
the tab is visible. Parked:
- keeping the link alive longer (`kMaxKeepAliveCount`) would fix the bench row but costs up to 120 wakeups/s for
  each second it stays up;
- sharing one compositor per window, as Chrome does, means rewriting how our tab views draw.

Shipped instead (2026-10-17): the link is woken on the user's intent. A native local monitor sees every left
mouse-down and mouse-up in a window outside a page's rect (sidebar, toolbar, titlebar) and runs one no-op
requestAnimationFrame in the shown page through page_script (`wakeFrames`), at most once per 100 ms per display.
Rows switch on release, so the link is already running at the show, and the new tab's compositor joins it: in the
trace the wake registers about 92 ms before the show, 10–11 display-link callbacks land in the 100 ms before it, and
the old source stays registered until the new one has. Release build, store `activate` 90 ms after a synthesized
mouse-down, interleaved in one instance:

| sidebar click → shown (median) | plain | prewarm |
|---|---|---|
| total, 90 ms press (n=12 each) | 13 ms | 5 ms |
| second BeginFrame after the show | 11.9 ms | 3.8 ms |
| total, 160 ms press (down and up both wake) | 15 ms | 8 ms |
| first display-link callback after the show (trace) | 7.9–18.3 ms | 1.5–8.6 ms (the next vsync) |

It costs about 60 µs of main thread per waking click and nothing without one (idle wakeups 0–0.1/s, interrupt 5/s,
the same with it off). A wake right before the switch (the keyboard case: ⌘1–9 switch on keydown) saves about 1 ms,
so keys don't wake. xbench's CDP-driven switch doesn't click, so its row doesn't show this.
(Its switch, `ARDIA_SWITCH_PREWARM`, went on 2026-10-26, after it shipped in 0.2.40.)

**New tab (+26 ms).** In Chrome, `Target.createTarget` adds a tab that is already in its window. In Ardia the
WebContents is made and starts loading in Chrome's strip, but it is only shown once the JS adopts it and React mounts
its view. Until then it is hidden, so its first paint waits for the mount. Same cause as the switch: the page isn't
on screen until a React commit puts it there.

Update (2026-10-19): a trace of `Target.createTarget` in nightly.7 shows the page already shown natively 2 ms after its
navigation starts (fab7aa20), well before it commits. What the bench row paid was the 11 ms from `createTarget` to the
navigation: 7 ms of it a synchronous LocalAuthentication XPC per tab (`ChromeAutofillClient` checking Touch ID for
`AutofillAiWalletPrivatePasses`). With that feature off (it shipped in 0.2.40; its switch went on 2026-10-26), navigation starts
1.5 ms after `createTarget` and the median first paint in a one-window probe is 46-53 ms against 56-59 with it on, same
build, interleaved. The user path (⌘T, then Enter) prewarms its tab, so it never paid that; there the store action now
sends the navigation to the engine (`platform/earlyNavigate.ts`) instead of the view's effect
after React re-renders, and the request leaves 5 ms after Enter instead of 24 (uBO's webRequest round trip used to
queue behind the New Tab page's teardown on the main thread). First paint 46 against 51 ms. What's left there is that
teardown: the response is handled only once React Native's ~14 ms of view updates on Enter are done.

**Memory at 10 and 20 tabs (+71 / +264 MB).** Every browser has the same process count, 1 renderer per tab: Ardia 25
processes at 20 tabs, Chrome 27. GPU (142 against 291 MB) and network/storage are smaller in Ardia; the browser
process is 168 against 132 MB. The gap is the renderers: 827 MB in Ardia against 475 MB in Chrome, 41 against
24 MB per tab, and Helium is in between at 692 MB, 35 MB per tab. The browsers with a built-in content blocker
(Ardia's uBlock Origin Lite, Helium's uBlock Origin, Dia's own) all have fat renderers; Chrome, which has none, is
lean. Ardia also injects `page_script.js` into every frame. Suspects, in order:
- uBlock Lite's content scripts (cosmetic filtering, scriptlets) in each renderer;
- the page script;
- a renderer-side flag that differs from Chrome's. Ardia runs with `--enable-features=WebContentsDiscard,…`, Chrome
  with its Finch seed.

The next run records each renderer's footprint by pid and can turn the blocker off for Ardia
(`--env ardia=…`), which isolates the first two.

Update (2026-10-17, full uBlock Origin in place of uBO Lite): renderers at 20 tabs are 730 MB (Helium 692), and the
extension process 71 MB (Helium 60). The browser process keeps about 25 MB after closing back to 1 tab (ctl too).
memory-infra dumps of it show the live objects return to baseline (PartitionAlloc's allocated objects 38.5 MB at 1
tab, 60.2 at 20, 38.8 after closing), while the allocator stays at 63 MB: free space in partly used pages.
A critical memory-pressure notification frees only 3.8 MB of it, and Hermes keeps no per-tab state (a full GC
frees 12 MB of heap but only 2 MB of footprint). It's fragmentation; tab-scoped partitions would be the fix, which
isn't worth an engine project for about 20 MB, so it's parked. Our base is higher than Helium's (108 against 76 MB
at 1 tab) mostly because the window is drawn in the browser process: two 16 MB IOSurfaces that Chrome keeps in
its GPU process (ours 52-131 MB, Helium's 132-209).

Update (2026-10-17, unparked): the two IOSurfaces were the hidden Metal view of each window's backdrop (vibrancy draws
it with an NSVisualEffectView): its CAMetalLayer kept two 2560×1600 drawables, 31.8 MB. While hidden its drawable is
now 1×1 (26a7a7fb). The retention after closing was mostly Hermes, not
PartitionAlloc: its heap grows from 8 to 29 MB over the session and keeps the freed segments (9 MB live), and each
forced full GC compacts one segment. state/tabs/memoryTrim.ts (25c2d1da) runs gc() until the heap stops shrinking, 5 s after
the tab count settles and only while Ardia isn't taking input, then `ac_memory_trim` (PartitionAlloc's ReclaimAll,
off the main thread). Browser process, hidden
Release, the session's flow: 1 tab 122 → 90 MB, back to 1 tab 121 (trim off) → 105 MB. xbench session A/B against
0.2.38-nightly.4 (`/tmp/ac-mem/xb1`, 3 rounds, totals): 1 tab 338 → 306, 10 tabs 773 → 739, 20 tabs 1142 → 1116,
back to 1 tab 423 → 391 MB; idle CPU and wakeups equal or lower. That build also carried an uncommitted launch-picture
capture that adds about 17 MB to the browser process after closing; without it the trim's own build reads 105 MB
back at 1 tab.

**Idle CPU at 20 tabs (+0.80 points).** Wakeups are the same (Ardia 29.8, Chrome 30.9 /s): every page's 1 s timer
wakes it in every browser. Ardia's renderers spend about 3× the CPU per wakeup: renderer CPU 1.17 % against
Chrome's 0.39 %. Helium, with uBlock Origin, is at 0.89 %. The same suspects as memory. Chrome may also be applying
a Finch-enabled background-tab policy that 154 with our switches doesn't, so this needs the blocker-off A/B and the
settled idle window (2 minutes after the last load) the next run adds.

**Launch, restored tab and link (+56 / +59 ms on median, ranges overlap).** Ardia's window is on screen first (358
against Chrome's 424 ms), but the page paints later. In 0.2.37 the restored tab's WebContents is created only after
the window's React content mounts (launch-critical-path.md: "the tab's WebContents is created after the window's
content mounts", ~115 ms window → FCP). The `launchTab` kill switch starts the page loading as the app starts, but
it is off in 0.2.37. The next run's Ardia template names the tab as `launchTab`, so a build with the switch on is
measured the way its users will have it. A link launch opens Little Ardia (a 900×640 window) beside the restored
main window, and pays the same.

**Download and on disk (context).** Helium is also arm64-only. The difference:
- uBlock Origin Lite's unpacked rulesets in `Resources/Extensions/ublock-lite`: 34.6 MB (full uBlock Origin, which replaced it, is 17 MB);
- a framework binary 24 MB larger (265 against 241 MB);
- React Native: main executable 9.1, hermes 4.6, JS bundle 3.9, assets 9.2 MB.

**New window.** `Target.createTarget({ newWindow: true })` gives Ardia a new normal Chrome Browser, which
`ArdiaHostEngineDelegate.mm -engineWindowForNewBrowserOfProfile:type:` hosts in a stray window
(`ArdiaWindowController.mm +strayWindowForProfile:`). Its tab ends up in the existing main window and no window
opens. The same path serves an extension's `chrome.windows.create`, so this is a parity bug, and its fix is in
progress separately. The row is null for Ardia until then; xbench counts a window when the target's window id differs
from the restored tab's.

**uBlock Origin's own cost (2026-10-17).** An A/B of 0.2.38-nightly.4 with and without its bundled uBO (both
re-signed ad hoc the same way) puts uBO's cost in memory, not launch: link 695 vs 646 ms and restore 493 vs 503 ms
are within noise, while 1 tab is 343 vs 262 MB, back to 1 tab 421 vs 337 MB, and idle CPU at 1 tab 0.40 vs 0.07 %
in a 15 s window right after launch. On a warm profile the uBO process idles like Helium's (40 vs 41 ms of CPU per
30 s at 20 s after launch, 0 at 120 s; heap after GC 8.05 vs 8.14 MB); our extra xbench idle is about a minute of
post-launch tail work. A load-after-first-paint deferral for launch was built and parked: it traded launch-time
blocking for no measured gain. In energy's idleVisible phase uBO is 0.07 mW against Helium's 0.06; the gap there is
background tabs (YouTube 0.56-0.87 % CPU against Helium's 0.01 %, with timer throttling the same in both: a hidden
page's 50 ms interval runs 0.5-1.2/s in each, nothing frozen).

**Power: video and hidden (2026-10-19).** The video row's gap (103 vs 95.4 mW, nightly.7) was all renderers. Both
browsers run 120 main frames a second on the YouTube watch page at 120 Hz, and our taller viewport makes YouTube load
its comments, so each frame costs more (9.4k nodes and 437 layers against 4.9k and 243). Chrome's
`ThrottleMainFrameTo60Hz` (Android ships it on) is now on: main frames at 60 Hz, compositor scrolling and animations at
120 (draws during wheel, trackpad and smooth scrolls and a CSS animation: 119-120/s either way), and 120 for the first
second after a tab is shown or created (`chromium-main-frame-throttle-after-show.patch`). Input asks for an urgent frame
(`UrgentMainFrameForInput`): keypress to next frame median 0.5 ms and max 8.5 against 9.5 and 16.7 without it, a
drag at 118 frames/s against 61. Side by side on nightly.7 the
video renderer went 79 -> 54 mW. The hidden row is mostly frozen tabs thawing: Chrome thaws each for 5 s every
minute, and the thaws held YouTube at 3.35 mW, The Verge 0.82 and CNN 0.68 in one 180 s window. Frozen tabs that never
opened a WebSocket, WebTransport or WebRTC connection now thaw every 10 min; tabs that did are never frozen, since
Chrome's freeze drops their WebSocket at the next thaw (`chromium-thaw-live-connections.patch`).

**Scrolling at full rate (2026-10-20).** The 60 Hz main frames above made scrolling uneven. Keys and the mouse wheel ran
main frames at 60 Hz while the compositor scrolled at 120, and a trackpad scroll got main frames at the cadence of its
input events. Whatever script or rAF placed from the scroll position lagged a draw behind in 38-47 % of frames
(`scroll-frames.mjs`). Main frames now stay at the display rate while a scroll is active and for 1 s after it or after
any input (`chromium-main-frame-full-rate-on-input.patch`). On battery, Battery Saver, which Ardia turned on there until 0.2.39 (now at 20 % battery or less by default),
capped every frame at 30 Hz, scrolling included. Input now lifts that cap for 1 s
(`chromium-battery-saver-full-rate-on-input.patch`). Cost: nothing measurable in energy.mjs's mains rows (idle, scroll,
switch, video, 3 rounds against the change switched off). On battery, an idle page is unchanged (18-19 mW) and
continuous scrolling goes from 121-123 to 157-161 mW.

Parked: packaged list times. On a fresh install uBO never caches its packaged list copies, so every default list
looks infinitely old and its updater runs 2 s after launch, downloading all 12 assets (9 lists, badlists, PSL,
assets.json) and compiling them again. A patch giving uncached packaged assets their own build date and expiry,
plus a release-time refresh of the bundled lists, was measured over a fresh install's first 10 minutes (uBO process
CPU, net-log): control 3.27 s and 12 downloads; refreshed lists with the patch 2.66 s and 2 downloads (the two 12 h
lists, genuinely stale); the patch with today's month-old lists 3.26 s and 12 (unchanged, as intended). All of it is
in the background and over by about 95 s. 0.6 s of CPU isn't worth a release-time list download step and its
supply-chain hardening (Codex: the registry must not steer destinations, downgrade and HTML checks, a list
generation in the manifest version), so it's parked; the diffs and reviews are in /tmp/ac-perfgap.

### Per process kind (medians over the 5 sessions)

| | Ardia | Dia | Helium | Chrome |
|---|---|---|---|---|
| memory at 1 tab, MB | browser 125, GPU 51, renderer 70, network 24, storage 19 | browser 185, GPU 120, renderer 82, AI utility 54, network 23, storage 17 | browser 76, GPU 132, renderer 61, extension 58, network 23, storage 19 | browser 98, GPU 172, renderer 78, network 12, storage 6 |
| memory at 20 tabs, MB | browser 168, GPU 142, renderers 827 | browser 317, GPU 564, renderers 822, extension 27, AI 54 | browser 111, GPU 209, renderers 692, extension 60 | browser 132, GPU 291, renderers 475 |
| idle wakeups/s at 1 tab | browser 3.3, renderer 2.0, GPU 0.8 | browser 9.5, renderer 2.0, GPU 1.2 | browser 1.7, renderer 1.5, GPU 0.9, extension 0.8 | browser 2.1, renderer 2.4, GPU 1.0 |
| idle CPU % at 20 tabs | browser 0.22, renderers 1.17 | browser 0.46, renderers 0.43 | browser 0.30, renderers 0.89 | browser 0.17, renderers 0.39 |

Ardia's browser process wakes 3.3/s at 1 tab against Chrome's 2.1 and Helium's 1.7: React Native's timers and
display link in the browser process (docs/perf/README.md, idle 5 s: 12–18 timers).

## Method

- **One harness, from outside the app.** Each browser is launched with `open -g -n`. The URL for a link launch is
  handed over by `open`, and Ardia ignores URLs in argv. Each is driven over CDP (`Target.createTarget`,
  `activateTarget`, `closeTarget`, `Browser.getWindowForTarget`, `Runtime.evaluate`); the test pages report their own
  paint timing.
- **Process measurements.** Memory, CPU and wakeups are `proc_pid_rusage` (acperf) over every process of the
  instance: its process tree plus anything running from inside its bundle (reported as `outside:<name>`, e.g.
  Chrome's and Helium's crashpad handlers).
- **The same pages for all.** native-bench's static page: 60 boxes, 120 paragraphs, a 1 s timer, paint and visibility
  marks. It is served from 127.0.0.1 on a fixed port (9462); there are no network-dependent rows.
- **The same profile state.** A template profile is made once per browser: one launch, the test page opened over CDP,
  every other page closed, 90 s to settle (components, filter lists, first-run work), quit. Every run starts from
  its own APFS clone of that template.
  - All four restore the same one-tab session. Ardia and Dia restore by default; Chrome and Helium get
    `--restore-last-session` (their "Continue where you left off").
  - Ardia's template drops its blank tab and gets the same 1280×800 frame.
  - Dia's template starts from a copy of a profile the owner signed in to once by hand, with a throwaway Atlassian
    account (Dia can't get past onboarding otherwise).
- **The same flags.**
  - Every instance: HOME and CFFIXED_USER_HOME point into its run folder, so nothing reaches the real `~/Library`.
    It also gets Ardia's background-mode switches `--disable-backgrounding-occluded-windows --mute-audio`, plus
    `--no-first-run --no-default-browser-check --password-store=basic`.
  - Chromium competitors also get `--user-data-dir --remote-debugging-port --remote-allow-origins=* --use-mock-keychain
    --window-size=1280,800 --window-position=40,80`. Dia ignores the window size and opens at 1512×949.
  - Ardia gets `ARDIA_BACKGROUND=1`, `ARDIA_DATA_DIR`, `ARDIA_REMOTE_DEBUGGING_PORT`, onboarding done,
    `ARDIA_INSTANCE` `updateFeed` at the local server, and `-NSAppSleepDisabled YES` (as native-bench).
- **How each runs.** This is where the setups differ.
  - **Chrome and Helium run as shipped:** they bring themselves to the front at launch and at every
    `Target.activateTarget`. They fetch their Finch (variations) seed and components as usual: no
    `--disable-background-networking`, which would remove background work Chrome really does.
  - **Dia runs in view without taking focus.**
  - **Ardia runs background-only,** in its test mode: it can't become the active app, its windows sit behind the
    owner's and report themselves as not occluded, and App Nap is off for it.
  - Background-only copies of Chrome were tried and rejected (A/B below): with their window behind the owner's,
    macOS treats them as occluded and switched-to tabs never get frames.
- **Machine in use.** The owner was working on this Mac throughout (it was not idle or locked). Browsers are
  interleaved item by item and rotated each round, so the owner's activity falls on all four alike, and every row is
  the median of 5–10 runs with min–max. Items ran one at a time under the perflab lock, 3 s apart. Chrome's and
  Helium's windows came to the front during their sessions.
- **Copies, never the installed apps.**
  - Chrome is Google's universal DMG (Developer ID Google LLC, EQHXZ8M8AV, notarized, `codesign --verify --deep
    --strict` valid once the DMG's FinderInfo xattrs were removed).
  - Helium is a clone of `/Applications/Helium.app`.
  - Dia is 1.53.0 from the vendor's DMG (S6N382Y83G, notarized), chmod a-w so Sparkle can't replace it. A 1.52.0
    copy updated itself to 1.53.0 within a minute. 1.53.0 is current.
  - Ardia is a clone of `dist/0.2.37/export/Ardia.app`.
- **Dia's defaults.** Dia writes its real defaults domain (`company.thebrowser.dia`) through cfprefsd, which ignores
  CFFIXED_USER_HOME. Each Dia instance runs between `defaults export` (to a 0600 file) and `defaults delete` +
  `defaults import`, so the owner's domain ends as it started; its contents are never read. Dia keeps its sign-in in
  the login keychain under its own access group; the throwaway sign-in wrote an item there.
- **Dia's restored tab.** Dia opens its window on its own start view at launch and leaves restored tabs hidden, even
  activated, so "restored tab painted" is null for Dia. Its sessions activate the restored tab over CDP before
  measuring.
- **Resumable.** Results append to `<out>/samples.jsonl` (one line per item). A failed item is logged and retried on
  the next run; only a browser taking focus without `--allow-focus`, or a copy updating itself, stops a run.

### Rows

| Row | How |
|---|---|
| Cold launch → page painted (link) | `open -a <app> <url>` with the browser closed → that page's first-contentful-paint, from just before `open` |
| Cold launch → window on screen | the pid's first on-screen window ≥ 300×200 with alpha > 0 (CGWindowList) |
| Cold launch → restored tab painted | `open -a <app>` → the restored page's FCP (native-bench's "launch → first page painted") |
| New tab → first paint | `Target.createTarget(url)` → FCP, median of 5 per session |
| Tab switch → shown | `Target.activateTarget` → visibilitychange to visible + 2 rAFs, median of 16 among 20 tabs |
| New window → first paint | `Target.createTarget(url, newWindow: true)` → FCP, counted only if a new window opened |
| Memory, 1 / 10 / 20 tabs, back to 1 | phys_footprint summed over every process (1 tab 30 s after launch, 10 tabs +10 s, 20 tabs +15 s, closed +30 s) |
| Idle CPU, idle wakeups/s, 1 and 20 tabs | rusage deltas over 60 s, every process (from the next run also a settled window 2 minutes after the last load) |
| Download, on disk (context) | the vendor's DMG for that version; `du` of the bundle |

### bench.json

```json
{
  "date": "2026-10-16",
  "machine": { "model": "MacBook Pro (Mac17,9)", "chip": "Apple M5 Pro", "cores": 15, "ram": "48 GB", "macOS": "27.2 (26B5112a)" },
  "browsers": { "ardia": { "name": "Ardia", "version": "0.2.37", "chromium": "154.0.8037.97" }, "dia": {}, "helium": {}, "chrome": {} },
  "rows": [
    { "id": "newtab", "label": "New tab → first paint", "unit": "ms", "lowerIsBetter": true, "best": "chrome",
      "browsers": { "ardia": { "name": "Ardia", "version": "0.2.37", "chromium": "154.0.8037.97", "median": 80, "min": 71.3, "max": 81.1, "n": 5 } } }
  ],
  "method": "docs/perf/vs-browsers.md",
  "notes": ["…"]
}
```

- Row ids: `launch-link`, `launch-window`, `launch-restore`, `newtab`, `switch`, `newwindow`, `memory-1`, `memory-10`,
  `memory-20`, `memory-closed`, `idle-cpu-1`, `idle-cpu-20`, `idle-wakeups-1`, `idle-wakeups-20`. From the next run
  there are also `idle-cpu-1-steady`, `idle-cpu-20-steady`, `idle-wakeups-1-steady` and `idle-wakeups-20-steady`.
- A browser that can't be measured on a row has `median: null` and a `note`. `best` is the best median, not a win:
  compare ranges.
- A variant run under its base name (`chrome-bg` as `chrome`) has `variant` set.

## Background-only Chrome (A/B, rejected)

Two interleaved rounds of normal Chrome against a copy with `LSBackgroundOnly` set (`xbench.mjs prepare-bg`: ad hoc
signed, restricted entitlements and hardened runtime dropped; it starts and runs). `/tmp/ac-xbench/ab`:

| Row | Chrome | Chrome, background-only |
|---|---|---|
| Cold launch → window on screen | 404 ms (394–427, n=6) | 373 ms (359–401, n=6) |
| Cold launch → restored tab painted | 424 ms (419–445, n=6) | 391 ms (375–416, n=6) |
| Tab switch → shown | 7.8 ms (7.5–8, n=2) | 1016 ms (1015–1016, n=2): 15 of 16 switches never showed |
| Memory, 10 / 20 tabs | 700 / 930 MB | 753 / 1157 MB (GPU process 519 against 293 MB) |
| New tab, new window, idle CPU and wakeups | overlap | overlap |

A background-only app can't come to the front, so its window stays behind the owner's (100 % covered) and macOS
treats it as occluded. Switched-to tabs never get frames, and the GPU process holds more. Ardia's test mode avoids
this only because its windows say they aren't occluded. The rows don't overlap, so the normal copies were used.

## Ardia: the harness against native-bench (cross-check)

Same app, same day, owner at work. native-bench ran with `--only launch,session --launch-runs 6 --runs 2` and 0.2.37's
bench bundle. xbench ran Ardia alone with `--gate off`.

| Row | xbench | native-bench |
|---|---|---|
| launch → window on screen | 372 ms (365–386, n=4) | 484 ms (417–536, n=6) |
| launch → restored tab painted | 505 ms (484–530, n=4) | 561 ms (506–660, n=6) |
| new tab → first paint | 79 ms (78–81, n=2) | 100 ms (91–109, n=2) |
| tab switch → shown | 40 ms (40–40, n=2) | 31 ms (27–35, n=2) |
| memory 1 / 10 / 20 tabs / back to 1 | 275 / 765 / 1187 / 363 MB | 284 / 761 / 1184 / 362 MB |
| idle CPU, 1 tab / 20 tabs | 0.17 % / 1.35 % | 0.16 % / 1.17 % |
| idle wakeups, 1 tab / 20 tabs | 6.7 / 29.0 /s | 6.7 / 29.1 /s |

Memory, idle CPU and wakeups agree: the same processes are measured the same way. The gaps come from the paths:
- **Launch.** native-bench runs a re-signed copy with `acmark.dylib` injected; xbench runs the notarized copy as
  shipped.
- **New tab.** `createTarget` starts the navigation in Chrome before Ardia's JS adopts the tab; the store's `newTab`
  goes through JS first.
- **Tab switch.** `activateTarget` goes through Chrome's tab strip and back through the JS mirror; native-bench calls
  the store directly.

Paint timing over CDP works with the screen locked: a locked-screen round of Ardia matched the unlocked one.

## Running it

```sh
OUT=/tmp/ac-xbench/final
node apps/browser/scripts/perf/xbench.mjs run --out $OUT --browsers ardia,dia,helium,chrome --rounds 5 --launches 2 \
  --gate off --allow-focus --base dia=/tmp/ac-xbench/dia-home --deadline 112   # run_in_background; rerun to resume
node apps/browser/scripts/perf/xbench.mjs report --out $OUT --browsers ardia,dia,helium,chrome --json apps/site/src/data/bench.json
node apps/browser/scripts/perf/xbench.mjs clean --out $OUT --browsers ardia,dia,helium,chrome
```

- **Run time.** A full run takes about 2 h 10 min. From the next run, sessions add the settled idle windows, about
  2.5 min more each.
- **A new Ardia build.** Add it as `--app ardia-main=<app>` beside `ardia` for a drift check against at least one
  competitor.
- **A/Bs.** `--env ardia=ARDIA_INSTANCE=chromiumSwitches=…` (or any K=V) runs a variant without touching the others.
- **Waiting for the owner.** `--gate away` (the default) waits for the owner to be away (screen locked for 60 s, or
  10 minutes without input), throws away an item the moment input comes, and reruns it.
