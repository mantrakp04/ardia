---
name: release
description: Cut and ship an Ardia release end to end, stable or nightly — write the Dia-style release notes from git log, bump the version, build/sign/package with scripts/release.sh, smoke-test the build in a hidden instance, publish the GitHub release (a prerelease for a nightly) + Sparkle appcast, and deploy ardia.dev with the release-notes entry, the new download link and the landing page's claims and screenshots brought up to date. Use this whenever the user asks to ship, release, cut/push a new version, a nightly or an update, publish a build, "ship it as a nightly", "get this to me", bump the version, or write release notes for Ardia — even if they only say "ship it", "nightly" or "new release" after a batch of fixes.
---

# Releasing Ardia

A release is: notes → version bump → `scripts/release.sh` → smoke test → GitHub release → site deploy.
The build and the publishing run in GitHub Actions: the **Release** workflow (`.github/workflows/release.yml`,
`docs/releasing.md` › CI releases) runs `release.sh`, signs, notarizes and publishes.
Locally you write the notes, bump the version, publish the engine when `engine/` changed, smoke-test, run the
stable perf gate, and update the site.
Users get it through Sparkle (Ardia › Check for Updates…), and the first launch of the new version
opens `https://ardia.dev/release-notes#<version>`. So the release isn't done until the site is
deployed with the new entry — otherwise that tab opens on a page that doesn't mention the update.

There are two channels (`docs/releasing.md` › Channels):

- **Nightly** (`0.2.37-nightly.1`): fast iteration, one fix at a time. Only the focused checks for what changed run;
  no perf ratchet, no perf gate, no landing-page refresh. It's a GitHub prerelease, so the site's download,
  the README and fetch-engine (all on `releases/latest`) keep pointing at stable.
- **Stable** (`0.2.37`): everything below, about 1.5 h with the smoke test, the update test, the ratchet and the
  perf gate. Its perf is compared with the previous **stable** release, never a nightly.

When the owner asks for a nightly, or a fix is ready and nobody said stable, run the nightly loop.

## The nightly loop

For each fix:

1. **Reproduce** it in a hidden instance (or the test that shows it) before touching code.
2. **Fix** it; commit straight to `main` (only your hunks).
3. **Verify** the fix the same way you reproduced it, once before and once after.
4. **Run the adjacent tests**: the checks for what changed (its acceptance checks, `packages/core` tests, the shortcut
   test, a smoke.mjs check), not the full suite.
5. **Build and release it as a nightly**:
   ```bash
   prev="$(git describe --tags --abbrev=0 --match 'v*')"                          # the previous release, either channel
   stable="$(git describe --tags --abbrev=0 --match 'v*' --exclude '*-nightly*')"  # the previous stable
   ```
   - Version: `<next stable>-nightly.<n>`, where the next stable is `$stable` with the patch bumped and `<n>` counts up
     from 1 since `$stable` (`git tag -l "v<next stable>-nightly.*"`). The build number goes up by one, as always.
   - Notes: `docs/release-notes/<version>.md` with the usual frontmatter, the headline and one to three
     bullets (`docs/release-notes/README.md` › Nightlies). Source: `git log $prev..HEAD -- apps/browser packages engine`.
   - Bump and build: step 3 below, with `scripts/release.sh <version>` (the `-nightly.<n>` version makes it a nightly).
   - Smoke test: `.claude/skills/release/scripts/smoke.sh <version> ${prev#v}`. Its update test runs the nightly's own
     appcast item twice: a copy of the previous build on Stable must not be offered it, one on Nightly must install it.
     All of it must pass, as for stable. To test CI's own build instead of a local one, see "Smoke-testing CI's build"
     in step 5.
   - Publish: commit and push the bump and notes, then
     `gh workflow run release.yml -R mantrakp04/ardia -f version=<version> -f dry_run=false` and
     watch it (`gh run watch <id> --exit-status`, in pieces under 10 minutes). It builds, tags, and runs
     `.claude/skills/release/scripts/publish.sh <version>` (a prerelease with the DMG, zip, appcast and CLI
     tarball; the merged feed onto the latest stable release; `Ardia-Nightly.dmg` behind https://ardia.dev/nightly;
     it checks all of them), and the Homebrew tap's `ardia@nightly` cask when the `HOMEBREW_TAP_TOKEN` secret is set
     (otherwise run `update-tap.sh <version>` yourself, step 5c). Locally the same is `git tag v<version> && git push
     origin main v<version>` and `publish.sh <version>` after `release.sh`.
   - Site: pushing the notes redeploys it (`.github/workflows/deploy.yml`), so the after-update tab finds the nightly's
     entry; check the deploy run finished (no `release.ts` change, no claims or screenshots). The nightly download link
     never changes.
   - Report in two lines: the version, the fix, the smoke result.

Batch nightlies when fixes land close together; never hold a fix back for a stable. A stable release's notes cover
everything since the previous stable, nightlies included.

`docs/releasing.md` is the reference for the machinery (keys, notarization, what release.sh checks);
`docs/release-notes/README.md` is the notes style guide. Read the style guide before writing notes.

## Ground rules (why they exist)

- **Never touch the Chromium build cache.** release.sh only reads the engine framework from
  `~/chromium-build/chromium_git/chromium/src/out/Release_GN_arm64` (and refuses one older than the tree's ArdiaCore
  sources: rebuilding it is an incremental `chrome_framework` build under the chromium lock). Never delete or clean
  `~/chromium-build/chromium_git/chromium/src/out`, run `gclient sync` or `gn clean`: a full Chromium
  rebuild costs ~5 hours and the user has been emphatic about it.
- **Never launch or touch `/Applications/Ardia.app`** (`Netnyahoo.app` until the owner updates past the rename) —
  the user is using it. Test only the exported
  build in `dist/`, only hidden (`ARDIA_BACKGROUND=1`, throwaway `ARDIA_DATA_DIR`), never with
  plain `open`. The smoke script does this for you.
- **Build from a clean tree.** release.sh archives the working tree, so another agent's half-finished
  edit would ship. Check `git status` first (below).
- **Commits** go to `main` with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## 1. Check the tree

```bash
git status --short
git log --oneline v<previous>..HEAD
```

Anything modified or untracked under `apps/browser`, `packages/`, `engine/` or `scripts/dmg` that isn't committed
would end up in the build (release.sh refuses to run with it). If it belongs to a running agent, wait for it or ask; don't commit
someone else's work in progress. Untracked files under `apps/videos`, `apps/site` or `output/` don't
affect the app.

For a stable release `<previous>` is the last stable tag (`git describe --tags --abbrev=0 --match 'v*' --exclude
'*-nightly*'`); nightlies in between don't count, for the notes range, the smoke test or the perf gate. The next version
bumps the patch (0.1.5 → 0.1.6) unless the user says otherwise.

## 2. Write the notes

Create `docs/release-notes/<version>.md` following `docs/release-notes/README.md`: frontmatter `date`
(today, `YYYY-MM-DD`) and `headline` (30–60 chars, one sentence, the only witty line: the most noticeable
change said dry and calm, true, no pun and no politics, with an open-country touch only where it fits, per
the README's Voice section), then `## New` / `## Faster` (the
perf-gate table, step 4c) / `## Fixed` / `## Smaller` bullets written from the user's side.

Source material: `git log --format='%h %s%n%b' v<previous>..HEAD -- apps/browser packages`. The commit
bodies already describe the user-visible symptom; translate them, don't paste them. Leave out the site,
the videos, docs and version bumps. Each bold lead says what the user can do or what stopped being
broken; no file names, flags or commit hashes. Items that came from an outside contributor's PR, or a
commit co-authored by one, end with `Thanks, [@handle](<PR url>).` (README step 5); check
`git log --format='%h %an %(trailers:key=Co-authored-by)' v<previous>..HEAD` and the merged PRs
(`gh pr list --state merged --search "merged:>=<previous release date>"`) so nobody is missed.

Check it renders: `pnpm -C apps/site build` and grep the headline in
`apps/site/dist/release-notes/index.html` (or preview it on port 4321, the "site" launch config).

## 3. Bump and build

First bring the content blocker up to date. uBlock Origin is bundled as a component extension, which
never updates itself, so its code is only as fresh as the last release that moved the pin (its filter lists
update themselves from the network, as uBO's do everywhere):

```bash
scripts/update-ubo.sh     # "uBO <x> is the latest release", or "uBO <old> -> <new> (sha256 …)"
git add packages/ardiacore/scripts/ubo.sh && git commit -m "Content blocker: uBlock Origin <new>"   # only if it moved
```

It checks the zip against GitHub's SHA-256 digest and the manifest's version, rewrites the pin in
`packages/ardiacore/scripts/ubo.sh` and installs it into `packages/ardiacore/vendor/ubo`. Verify after release.sh
that the export carries it: `python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])'
dist/<version>/export/Ardia.app/Contents/Resources/Extensions/ublock/manifest.json` prints the
pinned `UBO_VERSION` followed by ubo.sh's patch level as a fourth part (`1.75.0.8`: uBO refreshes its cached
scriptlets when that version changes, so our patches reach existing profiles), and the smoke test's "uBlock blocks an ad script" check passes. An error means
the release is odd (no digest, a version mismatch): keep the old pin and say so in the report.

```bash
sed -i '' 's/MARKETING_VERSION = <previous>;/MARKETING_VERSION = <version>;/; s/CURRENT_PROJECT_VERSION = <n>;/CURRENT_PROJECT_VERSION = <n+1>;/' \
  apps/browser/macos/Ardia.xcodeproj/project.pbxproj
git add docs/release-notes/<version>.md apps/browser/macos/Ardia.xcodeproj/project.pbxproj
git commit -m "Release <version>"
scripts/release.sh <version>     # ~15–25 min with notarization; run it in the background and wait
```

For a nightly, set `MARKETING_VERSION` to `<version>` (`0.2.37-nightly.1`) the same way, commit as "Nightly <version>",
and run `scripts/release.sh <version>`: the version alone makes it a nightly.

`release.sh` checks everything first, then runs the stages in `scripts/release/` in order: `archive.sh`,
`export-sign.sh`, `verify.sh`, `launch-check.sh`, `notarize.sh`, `package.sh`, `notes.sh`, `appcast.sh`. When one
fails, read its log in `dist/<version>/` and rerun that stage alone (each prints its usage); `notes.sh` prints the
GitHub notes without touching anything.

To release from CI instead, push the commit and dispatch the Release workflow (step 5): it runs this same `release.sh`
on GitHub's runner, so everything below about what it checks holds there too.
When `engine/` changed since the last published engine, publish the engine you built first, or CI has nothing to link:

```bash
scripts/publish-engine.sh --dry-run    # packs into dist/engine-<tree>, prints what it would upload
scripts/publish-engine.sh              # the engine-<tree> prerelease, never latest; appends prebuilt-engines.tsv's line
git add packages/ardiacore/prebuilt-engines.tsv && git commit -m "Prebuilt engine: <tree>" && git push origin main
```

`CURRENT_PROJECT_VERSION` is the build number Sparkle compares — it must go up every release, nightlies included
(release.sh refuses one that isn't above every build in the published feed; read the current value with `grep CURRENT_PROJECT_VERSION …project.pbxproj | sort -u`). release.sh refuses to run
if `MARKETING_VERSION` doesn't match, the notes file is missing, the tree has uncommitted app or engine
changes, or the engine framework is stale (`docs/releasing.md` lists what it checks). It notarizes the app and the DMG with the
`ardia` notarytool profile (an App Store Connect API key in the login keychain, set up 2026-09-26) and
ends with "Notarized and stapled." If it says "NOT notarized.", the profile is gone or invalid
(`xcrun notarytool history --keychain-profile ardia` shows why): stop and tell the user rather than
shipping an unnotarized build. Never store or re-create the credential yourself; that's the user's step.
Notarization adds a few minutes per submission.

## 4. Smoke test the build

```bash
.claude/skills/release/scripts/smoke.sh <version> <previous>     # --rc for dist/<version>-rc
```

First it checks the update from `<previous>` (its export in `dist/<previous>/export`):

- the engine is ArdiaCore (Chrome's framework, no CEF);
- the identity Sparkle, the keychain and TCC compare: same bundle id, executable, feed and EdDSA key, the build
  satisfies `<previous>`'s designated requirement, and its build number is higher;
- the appcast's EdDSA signature of the zip verifies with the app's key, and the zip holds this very app, sealed and
  stapled; Gatekeeper accepts the app and the DMG as notarized;
- `update-test.sh`: `<previous>`'s own Sparkle updates a scratch copy of it to this build, through a local feed made of
  the appcast's item (test bundle id and key; no relaunch, no UI);
- `carryover.sh`: `<previous>`'s data, made where an installed copy keeps it (two profiles: tabs, cookies including
  session ones, localStorage, passwords, bookmarks, history, an address, a site permission, zoom, an extension),
  opens in this build started without `ARDIA_DATA_DIR` (test copies in a fake home; never the real data).

Then it launches `dist/<version>/export/Ardia.app` hidden with a data dir that says `<previous>` ran last,
and a session whose window was left on its second profile, and checks, over CDP and the window list:

- the engine and chrome://version are the Chromium version `engine/patches/build/env.sh` names, and the after-update release-notes tab opened exactly once;
- the browser's child processes are the bundle's own helpers (Chrome's process checks pass under Developer ID);
- pages load, uBlock blocks an ad script, H.264/AAC/WebGL2;
- no hidden full-size Chrome window (since 0.2.0 the app window is Chrome's own; before, a hidden "ghost"
  sat behind it), and the window restores as the Work profile's Chrome window, alone on screen, its pages
  in the Work context;
- a passkey dialog comes in front, directly over the visible window it belongs to, and closes when the
  page navigates (the 0.1.2–0.1.4 regressions);
- the autofill dropdown accepts a suggestion (0.1.3), the offline page is Where's the lamb?, chrome://version;
- right-click shows the native context menu (0.1.5);
- with Chrome's last-used profile left at Work (as quitting with Work's window in front does), Personal's pages
  still run in Personal's profile (0.2.19 and earlier ran them in Work's);
- a page that stops responding is reported (Chrome's hang monitor reaches the app; 0.2.20 attached a DevTools client to
  every tab it showed, and Chrome ignores hangs while one is attached);
- quitting the way ⌘Q and Sparkle's update do (the quit Apple event, sent to this instance's pid only) exits
  within 15 s with status 0 and no crash report (0.2.6 and 0.2.7 crashed on every quit, so every update
  ended in "Ardia quit unexpectedly");
- the bundle's signature is still valid after running (0.1.0 wrote into its own bundle);
- the feed in the build's Info.plist (`SUFeedURL`, `https://ardia.dev/appcast.xml` since the rename) answers
  with an appcast (`.claude/skills/release/scripts/feed.sh --before-publish`). A 404 means ardia.dev is running a deploy without
  the feed endpoint (`infra/site/nginx.conf`): deploy the site first, or copies of this build never update.
  0.2.14 to 0.2.32 poll `https://netnyahoo.com/appcast.xml`, which the same site serves: across the rename smoke.sh
  checks that both lead to the same appcast.

Everything must pass before publishing. One known exception: the two passkey window-order checks read
CGWindowList, which isn't reliable while the Mac's screen is locked (window animations freeze). smoke.sh
detects the lock (`CGSSessionScreenIsLocked`) and prints them as SKIP; publish when the release doesn't
touch window ordering, and say so in the report. Before 0.2.0 the builds had three such checks (the
ghost's order), so a pre-0.2.0 export isn't a control for these. The window-list checks also fail, with an empty or
shrunken list, when the user switches Spaces or opens Mission Control during the run (the hidden instance's
windows leave the on-screen list): run it again. A failure is either a real regression (fix it, commit, rebuild —
don't publish) or the check itself going stale after an intended change (fix the check in
`.claude/skills/release/scripts/smoke.mjs`, and say so). When a release fixes a new class of bug that can be observed over CDP or
the window list, add a check for it to `smoke.mjs` so the next release guards it.

**After a fix mid-release, test only the fix.** When the smoke test, the ratchet or the perf gate fails and you fix it,
rebuild and re-run only what covers that fix: the failed rows (a launch-only native-bench for a launch row, the
ratchet for counts), plus the smoke test when the fix touches what it checks. Don't repeat the checks that already
passed on the earlier candidate; move on to publishing.

### 4b. Perf ratchet (stable only)

Check the candidate's counts against the ceilings before publishing (about two minutes, no perflab lock needed: they
are counts, not timings):

```bash
node apps/browser/scripts/perf/ratchet.mjs run --own --app dist/<version>-rc/export/Ardia.app   # dist/<version>/export without an rc
```

`--own` runs the app's own `main.jsbundle`, so it checks what ships. It must print `ratchet: ok`. It runs the launch,
idle, command bar, tab switch, navigate, scroll and hover scenarios in a hidden instance, and a count over its ceiling
gets one more run (a stray window event isn't a regression; a count over in both is). A failure is a real regression
(find the commit that added the commit, render, store update or timer, and fix it) or an intended increase: raise that
one ceiling by hand in `apps/browser/scripts/perf/ratchet.json` and say why in the commit and the release report. When
the release made counts go down, run `ratchet.mjs lower <the run's report>` (`$TMPDIR/ac-ratchet/ratchet.json`), commit
the lowered ceilings, and say which counts dropped. The wall-clock gate is a separate step: `docs/perf/README.md`.

### 4c. Perf gate: the RC against the previous stable release (stable only)

Every stable release is timed against the previous stable one before it publishes (never against a nightly: the
control is `dist/<previous stable>/export/Ardia.app`), and ships only when every row is the same or
better (`docs/perf/README.md` › Gating a release: native-bench with `--control dist/<previous>/export/Ardia.app`,
interleaved, launch x6+ and session x2, then js-bench alternating the two apps). It runs alone on a quiet Mac, holding
the perflab lock, after the smoke test and the ratchet. Call a row a regression only when the ranges separate.
Afterwards read `scripts/agent/cpu-cap`'s log (`cpu-cap.log`): a pause of the bench or its instances during the run
invalidates it, so rerun. Put the numbers in `docs/perf/<previous>-to-<version>.md`.

The notes get a `## Faster` section only when the release is measurably faster: a short table of the rows that
moved (old, new, change) and one sentence naming the biggest win. A release that's the same within noise has no
Faster section. (0.2.28 and 0.2.29 were also timed against 0.2.17, the last CEF release, with
`scripts/release-compare-0.2.17.sh`, now in git history: `docs/perf/README.md`.)

## 5. Publish

Both channels publish with `publish.sh` (`docs/releasing.md` › Cutting a release, step 4). From CI, after the smoke test
and, for a stable, the perf gate passed:

```bash
gh workflow run release.yml -R mantrakp04/ardia -f version=<version> -f dry_run=false
gh run list -R mantrakp04/ardia -w release.yml -L 1        # its id; then gh run watch <id> --exit-status, in pieces
.claude/skills/release/scripts/feed.sh <version>           # with a local dist/<version>/export, or curl ardia.dev/appcast.xml
```

`publish.sh` runs in the workflow's last job: it tags nothing itself (the job pushes `v<version>`), merges the appcast
onto the published feed, creates the release as latest with the DMG, zip, appcast and CLI tarball, checks
`releases/latest/download/appcast.xml` and `https://ardia.dev/appcast.xml` list the version, and updates the tap when it has `HOMEBREW_TAP_TOKEN` (else run `update-tap.sh <version>`). Locally:
`git tag v<version> && git push origin main v<version>`, then `.claude/skills/release/scripts/publish.sh <version>`.
It holds the `release-lock` branch while it publishes, so
it refuses to run alongside another publish, local or CI, naming the holder; `--break-lock` clears a lock older than
2 h left by a publish that died. The build job has no secrets; a separate sign job, which installs nothing, holds the
keys and deletes them before the launch check (`docs/releasing.md` › CI releases).

**Smoke-testing CI's build.** Dispatch with `dry_run=true` (the default): the same build as a release candidate
(`release.sh --rc`: the next build number, signed and notarized), published nowhere. Download it and run the smoke test
on it:

```bash
gh run download <id> -R mantrakp04/ardia -n release -D dist/<version>-rc
mnt="$(mktemp -d)" && hdiutil attach -nobrowse -readonly -mountpoint "$mnt" dist/<version>-rc/Ardia-<version>.dmg
mkdir -p dist/<version>-rc/export && ditto "$mnt/Ardia.app" dist/<version>-rc/export/Ardia.app && hdiutil detach "$mnt"
.claude/skills/release/scripts/smoke.sh <version> <previous> --rc
```

The release itself is then a second run with `dry_run=false` on the same commit.

The engine is never packed by a release: when engine/ changed since the last prebuilt engine, release.sh stops and
asks for `scripts/publish-engine.sh` first, which publishes `engine-<tree:12>` (with the Helium source) and appends
its line to `packages/ardiacore/prebuilt-engines.tsv`; commit that line before the release. Every release's notes end
with a Source section linking its tag, so never delete or move a published tag (`docs/releasing.md` › Source and
licenses).

`appcast.py merge` puts this release's item onto the feed as it's published right now, so nightlies that shipped while
this release was being tested stay listed (it rewrites `dist/<version>/appcast.xml`, keeping `appcast.built.xml`).
Both must show the new version. Copies from 0.2.13 and earlier poll GitHub's URL directly; 0.2.14 to 0.2.32 poll
netnyahoo.com/appcast.xml and later ones ardia.dev/appcast.xml, both served by the site, which counts the check
(version, day, first check or not) and redirects to the same GitHub file. feed.sh reads the URL from the built
Info.plist, so it checks what this build will poll; the copies from before the rename poll the other host
(`curl -sI https://netnyahoo.com/appcast.xml` must redirect to the same file).

### 5b. Staged rollout (an ArdiaCore-sized or risky release)

Three steps, in this order. Nothing here publishes by itself; each needs the owner's go-ahead (the first is the standing
rule that a release which changes the engine or something users would notice publishes only after the owner has tested
the final RC and said ship).

1. **The owner tests the RC first.** Build `scripts/release.sh <version> --rc`, hand it over, and wait for "ship". Not
   for a JS-only fix that passed the smoke test.
2. **Phased appcast.** Build the release with `scripts/release.sh <version> --phased 86400`. The new appcast item then
   carries `<sparkle:phasedRolloutInterval>86400</sparkle:phasedRolloutInterval>` (check with
   `grep -c phasedRolloutInterval dist/<version>/appcast.xml`, which must print 1): Sparkle gives each copy a random
   group on that Mac (no ID, nothing sent) and offers the update to the first seventh of copies at once, a seventh more
   every interval, so everyone has it after a week. Someone who clicks Check for Updates… gets it at once. Publish as in
   step 5 and watch a day or two: `crash.log`, new `$exception`s in `telemetry.events` and errors in
   `telemetry.logs` (`.claude/skills/stats/queries.md`, Errors), `update_check` counts by version
   (`docs/growth.md`). A problem found: flip the release's kill switch (`docs/kill-switches.md`) if it has one, and
   publish a fixed build with a higher build number: copies that haven't updated yet go straight to it.
3. **Everyone.** Remove the interval from the published appcast, so every copy sees the update:
   ```bash
   .claude/skills/release/scripts/rollout-everyone.sh <version> --dry-run   # the diff it would upload
   .claude/skills/release/scripts/rollout-everyone.sh <version>
   ```
   It holds the publish lock (`release-lock`, the same one `publish.sh` takes), so a nightly published meanwhile can't
   be overwritten. It edits the feed on the latest stable release as it is at that moment (`appcast.xml`), drops the
   interval from `<version>`'s item only, uploads it and checks what GitHub serves. (The appcast isn't signed as a whole, only its zip's `edSignature`, so editing the line keeps it
   valid.) The next release's `release.sh` starts from this published appcast, so it doesn't bring the interval back.

A release without `--phased` goes to everyone at once, as before.

### 5c. Homebrew tap

https://github.com/mantrakp04/homebrew-tap holds `Casks/ardia.rb` (stable) and `Casks/ardia@nightly.rb`, so
`brew install mantrakp04/tap/ardia` installs the latest DMG. `update-tap.sh <version>` clones the tap into a temp dir,
sets the matching cask's `version` and `sha256` (GitHub's digest of the published DMG, checked against
`dist/<version>/`), and pushes; `--dry-run` prints the diff instead. It refuses a version older than the cask's and
does nothing when the cask is already there. `publish.sh` runs it for both channels (in CI only with the
`HOMEBREW_TAP_TOKEN` secret; otherwise run it yourself after the workflow). The casks have `auto_updates true`: Sparkle updates installed copies and `brew upgrade`
skips them, so a late tap push only delays new installs. Lint after a cask edit by hand (never `brew install` it: that
writes `/Applications/Ardia.app`): `brew audit --cask --online mantrakp04/tap/ardia` and `brew style mantrakp04/tap`.

## 6. Deploy the site

The download buttons and the root `README.md` (the landing page on GitHub) link the DMG of one tag
(`releases/download/v<VERSION>/Ardia-<VERSION>.dmg`), so they keep working after a publish and only point at the
older version until this step. After a stable publish, point both at it:

```bash
.claude/skills/release/scripts/site-version.mjs <version>
```

It reads the published DMG's size from GitHub, writes `apps/site/src/data/release.json` (`VERSION` and `DMG_SIZE`
in `release.ts` come from it) and rewrites the README's links, labels and sizes. Commit both. If a release changes a
claim on the landing page (below), change the README's matching line too.

**Bring the landing page's claims up to date.** The home page makes specific promises; a release can make
one of them stale or earn a new one. Read the new notes against:
- `Faq.astro` (Q&A), `Hero.astro` and `Closing.astro` (the fine print: macOS version, Apple Silicon,
  Notarized), and `Footer.astro`.

Then:
- **Something the page claims changed** (a new import source, a new requirement): fix the line.
- **Bug fixes and small changes:** leave the page alone.
- **Never claim anything the release doesn't do.** Anything unverified or behind a setting says so.

**Bring the landing page's pictures up to date too.** Every screenshot on the site claims "a screenshot,
not a mockup", so it has to look like the app people download today. Here is what shows which part of the
app (listed in `apps/site/README.md` › Screenshots):

| Asset | Shows |
|---|---|
| `src/assets/shots/window.webp` | the whole window: sidebar, pinned tiles, tabs, a page (Fig. 2, `Showcase.astro`) |
| `shots/address-{toolbar,sidebar}.webp` | the address bar feature's before and after |
| `shots/profile-*.webp` | the profiles feature, one window per profile |
| `shots/split.webp`, `extensions.webp`, `privacy.webp` | split view, the Web Store, Settings › Privacy & Security |
| `src/assets/app-icon.png` | the header, the favicon source |
| `src/assets/game/crowd.webp` | the offline game; its hotspot is in `Game.astro` |
| `public/og.png` | the share card |

- **When:** if the release visibly changes something a shot shows (the sidebar, the tiles, the New Tab page,
  the logo or mark, the icon, a Settings pane, the window chrome), retake the affected shots from **this
  release's export** (`dist/<version>/export/Ardia.app`).
- **How:** use a hidden instance with the smoke test's rules (`ARDIA_BACKGROUND=1`, a throwaway
  `ARDIA_DATA_DIR`, never plain `open`, never `/Applications`).
  - Set up the same state as the old shot (the same sites, profiles, light or dark).
  - Take a real window capture at 2× with a transparent outside: `screencapture -l <windowID> -o`.
- **Screen locked:** WindowServer captures fail. Leave the old shot, and tell the user which shots are stale.
  An in-process snapshot is not a substitute: it drops glass and Metal views.
- **Replace in place:** save the new capture over the file with the same name, since Astro makes the sizes.
  Update the shot's `alt` text if what it shows changed, and check its phone crop (`focus` where the shot is used).
- **Don't touch the rest:** leave the painted logo (`ardia-mark.png`, from `docs/brand/ardia`) alone unless
  the brand changed.

Keep to the site's bar: few words, witty over wordy (see the existing lines). Build with `pnpm -C apps/site build`
and check the changed sections and shots render, on a phone width too (the "site" launch config, port 4321).

```bash
pnpm -C apps/site run deploy   # the upload can drop on a weak connection: rerun it until it succeeds
```

Then verify live: `https://ardia.dev/release-notes/` contains the new headline, the home page links
`Ardia-<version>.dmg`, that URL returns 200, and any claim you changed shows. Commit `release.json`, the README
and the claim changes ("Site: download <version>", plus what changed) and push.

The SEO data follows `release.json` and the notes by itself, with no extra step; check that it did:
- The home page's JSON-LD `softwareVersion` is the new version.
- `https://ardia.dev/release-notes/<version>/` exists (every notes file gets its own page, built from the
  `releaseNotes` collection), and its description reads well: it comes from the intro paragraph, or else the
  headline plus the bold leads, so a clear first line pays off.
- `https://ardia.dev/sitemap.xml` has today's `lastmod` and lists the new stable page. Nightly pages exist too,
  but stay `noindex` and out of the sitemap.
- If the release changed what Ardia is (a new headline feature, a new platform), update the home page's
  `description` in `src/pages/index.astro`: ~150 characters, and it is also the share text.
- If `og.png` changes, its URL's `?v=` hash changes with it, so X and others fetch the new card.

Deploying makes things public. The user has asked for releases to go all the way through, so deploy as
part of a release; for site changes outside a release, ask first.

### 6b. The before-and-after film (every release, nightlies included)

Each release gets a Remotion film of its fixes: the same clicks on the previous release and on this one, side by side
(`apps/videos/src/videos/fixes-<id>`, like `fixes-0243n1`; footage in `apps/videos/public/footage/<id>`, filmed in
hidden instances, captured by pid). Once the release is published:

```bash
pnpm -C apps/videos render fixes-<id>
ffmpeg -i apps/videos/out/fixes-<id>.mp4 -an -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -movflags +faststart \
  apps/site/public/release-videos/fixes-<id>.mp4
ffmpeg -ss 1 -i apps/site/public/release-videos/fixes-<id>.mp4 -frames:v 1 -vf scale=1600:-1 -q:v 4 \
  apps/site/public/release-videos/fixes-<id>.jpg
```

Keep the web copy under about 8 MB. Add `video: fixes-<id>` to the frontmatter of `docs/release-notes/<version>.md`
(and of any nightly the film also covers), commit the composition, the two files and the notes, and push: the site
redeploys and plays it above the notes. `release.sh` links it in the GitHub body only when `video:` was set before
the build, so for a film made after publishing add the same section by hand:

```bash
gh release view v<version> -R mantrakp04/ardia --json body -q .body > /tmp/body.md
printf '\n## Before and after\n\nThe fixes, filmed on the previous release and on this one: https://ardia.dev/release-videos/fixes-<id>.mp4\n' >> /tmp/body.md
gh release edit v<version> -R mantrakp04/ardia --notes-file /tmp/body.md
```

The section goes before `## Install` when release.sh writes it; appended at the end is fine by hand. Keep the footage
until the film is on the site: without it the film can't be rendered again.

## 7. Report

Tell the user, briefly: the version and headline, what's in it (from the notes), any landing-page claims changed, the smoke result
(N/N), that it's live (release URL, appcast, site), how to get it (Check for Updates…), anything not
verified (real trackpad/mouse input, notarization), and what they need to try by hand.
