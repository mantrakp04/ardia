# Contributing to Ardia

Ardia is a macOS browser with Dia's polish and Arc's sidebar, running on Chrome's own framework (Chromium 154). One
person runs it, with a lot of help from coding agents, and ships nightlies most days. Pull requests are welcome. This
page is what the owner keeps asking for, written down so you don't have to learn it from a review.

## What we will and won't take

Ardia copies Dia's look and behaviour on purpose, and uses Arc's layout for the sidebar. A change that makes it
behave more like Dia is almost always welcome. A change that restyles it to taste is not, unless the owner asked.

Out of scope:

- **AI features.** The owner decided against them. Dia's AI rows in `docs/dia-feature-parity.md` stay ⏸.
- **Accounts or sign-in of our own.** Sync goes through the user's iCloud Drive and nothing else.
- **Telemetry that carries browsing data.** Crash reports are opt-in and never include sites or searches.

`docs/dia-feature-parity.md` is the checklist of what's done and what isn't. Pick from there if you want something
to do, and update its row in the same PR.

## Getting it running

You need an Apple Silicon Mac on macOS 14 or later, Xcode, CocoaPods, Node and pnpm 11.

```sh
pnpm install
pnpm pods
pnpm dev      # Metro, leave it running
pnpm macos    # builds the Debug app and opens it
```

You don't need to build Chromium. When there's no Chromium tree at `~/chromium-build`, the app's build downloads the
prebuilt engine that matches your checkout's `engine/` folder
(`packages/ardiacore/scripts/fetch-engine.sh`). That only works while `engine/` is unchanged from a commit on `main`.
If you change the engine you need your own Chromium build: `docs/engine-build.md` has the whole thing, and a first
build takes about five hours.

`pnpm macos` runs the app on its own data folder, `~/Library/Application Support/Ardia Dev`, so it never touches the
Ardia you browse with. Keep it that way. A Debug build refuses to start without `ARDIA_DATA_DIR`, and every test
instance should get a throwaway one. To run a build without it popping up over your work:

```sh
open -g -n --env ARDIA_BACKGROUND=1 --env ARDIA_DATA_DIR=/tmp/ardia-test \
  --env ARDIA_REMOTE_DEBUGGING_PORT=9333 apps/browser/build/Build/Products/Debug/Ardia.app
```

A JS-only change doesn't need a rebuild. Metro reloads it, though relaunch the instance before you judge the result.

Where things live:

| Path | What |
| --- | --- |
| `apps/browser` | The React Native macOS app: UI, store, actions |
| `packages/ardiacore` | The engine, ArdiaCore: Chrome's framework and the native modules the app calls |
| `packages/shell` | Menus, shortcuts, windows, native views |
| `packages/core` | Omnibox parsing and suggestions, pure TypeScript with tests |
| `packages/import`, `packages/sync`, `packages/shaders` | Importing from other browsers, iCloud sync, Metal views |
| `engine/` | Our patches to Chromium and our Chrome-side code |
| `apps/site` | ardia.dev (Astro) |
| `infra/<service>` | Deploy setups, one folder per service |

`docs/agent-brief.md` explains the architecture in depth. It's written for agents and is just as useful to people.

## What a good change looks like

### It matches Dia, measured

"Looks close" isn't a match. Compare against a Dia capture of the same state with the same crop, and give the
numbers: sizes, spacing, colours, and for motion, timing in frames. Record both browsers and step through at 30 fps.
A bug fixed at 24 fps has come back more than once because the glitch lived between frames. `docs/dia-spec.md` holds
the values already measured from Dia.

Parity covers behaviour too. Most bugs the owner reports are UX that any browser user expects without thinking:

- Dismissing something never pauses playback, opens a window, or drags you to another tab. Closing the mini player
  must not bring the browser forward.
- Going back to the source ends the temporary view. Open the tab whose video is in picture-in-picture and PiP stops.
- Clicking outside a popover or a focused field closes it.
- Nothing reopens right after you close it.
- Actions follow the active profile and the last active window. A link from another app opens in the profile you were
  just using, and ⌘⇧T reopens this profile's tab, not the other one's.
- Hover never moves anything.
- Motion animates. Sidebars slide, the toolbar eases away, the command bar grows out of the URL field. Nothing snaps
  into place or flickers, traffic lights included.
- Shortcuts match Chrome and Dia, in every focus. On a trackpad ⌘-scroll scrolls; with a mouse it zooms. That one
  has regressed twice.
- Check every layout you touched: address bar in the sidebar, address bar on top, horizontal tabs. Several bugs only
  showed up in one of them.

### It lets Chrome do the work

Ardia is real Chromium. Before writing our own version of something, check whether Chrome already does it and we're
getting in the way. "Shouldn't Chrome's default behaviour just work here?" is the first question the owner asks about
a bug, and the answer is often yes. When a fix needs a hook in Chrome's code, keep it the smallest hook that works.

### It's simple

A bug that happens sometimes usually means two pieces of code disagree about who owns the state. Pressing F to leave
full screen once put the video into PiP, flickered PiP, or worked, depending on timing. The fix there was deleting a
layer, not adding a guard. Prefer the change that removes code. Reject complexity out of proportion to the gain: a
900-line change to save 2 ms doesn't go in.

### It's fast, and stays fast

Performance is judged against the previous stable release: same or better, measured interleaved on a quiet machine
(`docs/perf/README.md`). Every cache, prefetch or cut request ships with a staleness test. Create something, reload,
and it's there. Delete it, and it's gone. Fewer requests isn't a goal by itself, and a metric that hasn't been shown
to follow real wall-clock time doesn't count as proof.

## Code style

- **No comments.** Not in source, scripts or config. Name things so the code says what it does, and put the why in
  the commit message. Tool directives (`@ts-expect-error`, `#pragma`, `swiftlint:`), shebangs and license headers
  stay.
- Read the surrounding code first and match its naming and idioms. New features go in new files where that makes
  sense.
- Read `docs/store-api.md` before you touch app state.
- Skills live only in the root `.claude/skills`. Deploy setups live only in `infra/<service>`.
- Patched npm dependencies live in `patches/`, listed in `pnpm-workspace.yaml`. `docs/agent-brief.md` explains how
  to change one.
- When JS starts needing native code older builds lack, bump `NATIVE_API_VERSION` in `apps/browser/src/platform/nativeApi.ts`
  and `apiVersion` in `packages/shell/ios/AppModule.swift` together.

## Testing

Reproduce the bug before you fix it, ideally with a check that fails. Then fix it and watch the same check pass.
Tests run the real production code. A copy of the logic inside a test proves nothing about the app.

Run what covers your change, once before and once after, then the checks next to it. You don't need the full suite
for a small fix.

```sh
pnpm typecheck
pnpm test                               # every unit test, cached by Turbo
python3 engine/patches/series.py check  # if you touched engine/patches
```

The end-to-end checks (shortcuts, tab dragging, profile swipes, windowing, sync, import, the engine acceptance run)
need a built app and run hidden instances. `docs/testing.md` lists each one with what it guards. When you fix a
regression, add its case to the matching check so it can't come back quietly.

Never read a real browser profile in a test, Ardia's included. Build fixtures. Screenshots for the site, the README or
a PR use neutral pages, never someone's feed or personal data.

## Engine changes

Chromium builds are incremental. Never run `gn clean` or `gclient sync` on a tree you care about, and don't delete
`out/`: a full rebuild costs about five hours. Patches go in `engine/patches/` in the order `engine/patches/series`
gives, and our Chrome-side code lives in `engine/chromium` and `engine/ardiacore`. `docs/engine-build.md` covers
both. A PR that changes `engine/` means the next release publishes a new prebuilt engine, so say so in the
description.

Security-sensitive code gets extra care. Passwords and card numbers stay on their native path and never go through
the generic JS-to-engine call. Anything that weakens a Chrome security UI (the full-screen exit notice, permission
prompts, re-auth) needs a strong reason in the PR.

## Reporting a bug

The fastest bug to fix is one with a screen recording. Include:

- the version and channel (Settings › General; stable or nightly),
- your layout: sidebar or top address bar, sidebar or horizontal tabs,
- how many profiles and windows you have open,
- the steps, and how often it happens if it's only sometimes,
- the same steps recorded in Dia, if Dia behaves differently,
- the crash report from `~/Library/Logs/DiagnosticReports`, if it crashed.

## Pull requests

- **Issue first.** Every PR closes an issue. Open one (or find the existing one) describing the bug or the request
  before you open the PR, then put `Closes #<issue>` in the PR description. A PR with no linked issue fails the
  "Linked issue" check and won't be reviewed. Several PRs can point at the same issue.
- One change per PR. Describe it the way a user would notice it ("dragging a tab onto another groups them"), then
  how you checked it.
- For anything visible, attach a recording or before-and-after captures, ideally next to Dia's.
- Commit messages carry the why, since the code doesn't have comments. Look at `git log` for the style: a short
  subject saying what changed for the user, then a plain paragraph.
- `main` moves fast and the owner commits straight to it. Rebase before you ask for a review.
- Sometimes the owner lands your work in a different shape, or pulls part of a PR into their own commit. When that
  happens you stay on it as a `Co-authored-by:` trailer, and the release notes item ends with "Thanks, @you" linked
  to your PR.

Releases, the site deploy and anything posted publicly are the owner's job. Don't bump versions or touch the appcast
in a PR.

## Writing

Copy in the app, on the site and in release notes is short, plain and a little funny. Internet slang is fine.
Corporate-cute lines aren't. "Sign-up not included" got cut for being cringe, and so did the "no account" and
"no sign-up" tags and the price badge. Say what the thing does with a number or a mechanism. Release notes
follow `docs/release-notes/README.md`. The site has to look right on a phone.

## Working with a coding agent

Plenty of Ardia was written by agents, so using one is fine. Point it at `AGENTS.md` and `docs/agent-brief.md`
first. Those files hold the owner's standing rules (hidden test instances, no focus stealing, isolated builds, the
no-comments rule), and they're why a change goes in without a long back-and-forth. For risky logic (races, object
lifetimes, security, migrations, sync), get a second model to review the change before and after, and reproduce each
finding before acting on it. Check the agent's diff yourself before you open the PR. You're the one answering for it.

## License

Ardia's own files are Apache-2.0, and Ardia as distributed is GPL-3.0 (see NOTICE). Before your first pull request
is merged you sign the [Contributor License Agreement](CLA.md): you keep the copyright in your work and license it to
the project, including the right to relicense it, commercially as well. The CLA bot asks on your pull request, and
signing is one comment.
