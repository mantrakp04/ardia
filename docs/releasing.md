# Releasing

Releases are GitHub releases of `mantrakp04/ardia`, tagged `v<version>`, on two channels: **stable** (`0.2.37`, a full
release) and **nightly** (`0.2.37-nightly.1`, a GitHub prerelease: one fix, shipped the day it's made; "Channels" below).
Since the Release workflow (`.github/workflows/release.yml`, "CI releases" below) a release is built and published in
GitHub Actions. Each has these assets:

- `Ardia-<version>.dmg`: what people download (the app and an `/Applications` link, in a window with the
  site's poster behind them: `scripts/dmg`, where `render.sh` redraws the picture and `layout.sh` the layout).
- `Ardia-<version>.zip`: the archive Sparkle installs updates from.
- `ardia-cli-<version>-macos-arm64.tar.gz` and its `.sha256`: the `ardia` command (`docs/cli.md`).
- `appcast.xml`: the Sparkle feed, both channels' items in one file. The latest stable release's appcast is the feed
  (a nightly rewrites that asset; "Channels" below). Builds after 0.2.13 poll
  `https://ardia.dev/appcast.xml` (`SUFeedURL`), which counts the check by version and day (and whether
  it's the copy's first) and redirects to
  `https://github.com/mantrakp04/ardia/releases/latest/download/appcast.xml`, the URL 0.2.13 and
  earlier poll directly. The count can't block an update: see `infra/site/nginx.conf` and `docs/growth.md`
  › Installs.
- `ArdiaCore-<engine tree>.tar.xz`, only in a release built locally from a Chromium tree whose `engine/` changed since
  the last one: the release's engine (Chrome's framework, stripped), so the app builds without a Chromium tree. Engines
  for CI releases go to their own prerelease instead, `engine-<engine tree:12>` ("Engines" below). `packages/ardiacore/prebuilt-engines.tsv` maps
  `engine/`'s git tree to the release and the archive's SHA-256; `packages/ardiacore/scripts/fetch-engine.sh` downloads
  it (the app's build runs it when there's no local engine build).
- `ArdiaCore-<engine tree>-source.tar.xz`, with that archive when the engine is built on Helium (release.sh finds
  Helium's code in the framework): copies of the GitHub tags `engine/patches/build/env.sh` pins that aren't in this
  repo (`scripts/engine-source.sh`), and where Chromium's source is. See "Source and licenses" below.

Each version's notes are a file in the repo, `docs/release-notes/<version>.md` (how to write one:
`docs/release-notes/README.md`). The GitHub release, the update dialog and the website's
`https://ardia.dev/release-notes` all come from it. The first launch after an update opens
`/release-notes#<version>` in a new tab (`apps/browser/src/state/releaseNotes/releaseNotesPage.ts`), so the site has to be
deployed with the new entry by the time the update reaches people.

## Channels

Ardia is one app with two Sparkle channels. A stable item in the appcast has no channel; a nightly item carries
`<sparkle:channel>nightly</sparkle:channel>` (`generate_appcast --channel nightly`). Sparkle skips items on a channel the
app doesn't allow, and allows none by default, so every shipped build (all on Sparkle 2.9.6, which has channels) and
every copy on Stable sees only stable items. A copy on Nightly allows `nightly` (`allowedChannels(for:)` in
`packages/shell/ios/AppUpdater.swift`) and so gets the newest of both.

- **Which channel a copy is on.** Settings › General › "Update channel" (Stable / Nightly), kept in the defaults key
  `ACUpdateChannel`. Until the user picks, it's the channel of the build that first ran: the `ACUpdateChannel` key in
  `Info.plist`, which `release.sh --channel nightly` sets to `nightly` (the build setting `AC_UPDATE_CHANNEL`). It's
  written at the first launch, so a nightly copy stays on Nightly after it updates to a stable build. Switching to
  Stable never downgrades: Sparkle only offers a higher build number, so the copy waits for the next stable.
- **Versions.** Sparkle compares `sparkle:version`, the build number (`CURRENT_PROJECT_VERSION`), which goes up by one
  every release on either channel; the version string is only shown. A nightly is `<next stable>-nightly.<n>`, so
  0.2.36 (44) < 0.2.37-nightly.1 (45) < 0.2.37-nightly.2 (46) < 0.2.37 (47). Sparkle's comparator can't order the
  strings themselves (it reads `0.2.37-nightly.1` and `0.2.37-nightly.2` as equal), which is why it never sees them.
  `release.sh` refuses a build number that isn't above every build already in the feed, nightly or stable. About Ardia
  and Settings show a nightly as "0.2.37 Nightly 1".
- **The feed.** It stays where every shipped build reads it: `https://ardia.dev/appcast.xml` redirects to
  `releases/latest/download/appcast.xml`, and GitHub's "latest" skips prereleases, so it's always the newest stable
  release's `appcast.xml`. A stable release publishes the merged feed as its own asset and becomes latest; a nightly
  re-uploads the merged feed onto that same latest stable release (`gh release upload … --clobber`). Nothing moved:
  no new URL, no nginx change for the feed, and the copies from 0.2.13 and earlier that poll GitHub directly read the
  same file. Both flows build on the published feed (`release.sh` fetches it and refuses to go on without it), and
  `appcast-merge.sh` puts the new item onto the feed as published at that moment, so a nightly that shipped while a
  stable was being tested isn't dropped. `generate_appcast` keeps 3 items per channel.
- **Downloads.** Stable keeps its versioned link (`releases/latest/download/Ardia-<version>.dmg`, from
  `apps/site/src/data/release.ts`). Nightly has one fixed link, `https://ardia.dev/nightly` (`infra/site/nginx.conf`),
  which redirects to the `nightly` prerelease's `Ardia-Nightly.dmg`; each nightly re-uploads that asset, so the site
  never redeploys for a nightly.
- **Proof.** `.claude/skills/release/scripts/channel-test.sh dist/<stable>/export/Ardia.app` runs that build's own
  Sparkle against local feeds made by `generate_appcast`: on stable it isn't offered a nightly, and with a newer
  nightly in the feed it takes the stable; on nightly it takes the nightly, a newer stable, and the newest of both. It
  also checks the build-number order with Sparkle's comparator. `update-test.sh` does the stable-ignores-it half for
  every nightly's own item.

## Source and licenses

Every binary we publish (DMG, zip, engine archive) has its source next to it, and keeps it for as long as the binary
stays up. That's GPL-3.0 §6(d) for the GPL parts (uBlock Origin today), and it's how we work anyway.

- Every release's notes end with a Source section (`release.sh` writes it). It links the tag's tree: the app, the
  engine's patches, `gn_defines.sh`, the step scripts and this release flow. Once the engine is built on Helium, it
  also links the `ArdiaCore-<tree>-source.tar.xz` asset of the release that carries that engine (the `v<version>` that first shipped it, or its `engine-<tree:12>` prerelease)
  (`packages/ardiacore/prebuilt-engines.tsv`); `release.sh` refuses such an engine when it can't name that release.
- The `nightly` release's body names the nightly its `Ardia-Nightly.dmg` is and links that release
  (`publish.sh` rewrites it each time).
- Never delete or move a `v*` tag, or a release's source asset, while its release is up. A release can come down;
  its tag stays.
- About Ardia and Settings › Advanced › "Source and licenses" link the running version's tag. The app carries
  `LICENSE*` and `NOTICE` in `Contents/Resources/Licenses`.

## Once per machine

- The **Developer ID Application: mantra patel (U5L5T3NGVV)** identity in the login keychain, and Xcode
  signed in to the team: the export fetches the Developer ID provisioning profile
  (`-allowProvisioningUpdates`) that the keychain-group entitlements need.
- The **Sparkle EdDSA key**, a login keychain item (service `https://sparkle-project.org`, account
  `ardia`, or the app's old name in lower case on the Mac that made it before the rename: `LegacyName.appName`;
  release.sh finds either, `SPARKLE_ACCOUNT` overrides). Its public half is `SUPublicEDKey` in
  `apps/browser/macos/Ardia-macOS/Info.plist`. Every update must be signed with it, so keep a backup:
  `apps/browser/macos/Pods/Sparkle/bin/generate_keys --account <account> -x <file>` exports it, and `-f <file>`
  imports it on another machine.
- For notarization, an App Store Connect API key (Team Keys, Developer role). Keep `AuthKey_<id>.p8`
  outside the repo (e.g. `~/.private_keys/`, mode 600) and point `scripts/.notary.env` (untracked) at it:
  `NOTARY_KEY=<path>`, `NOTARY_KEY_ID=<id>`, `NOTARY_ISSUER=<issuer id>`. release.sh prefers it to the
  keychain profile below, which notarytool keeps in the data-protection keychain: that reads as
  missing while the screen is locked. Otherwise, a notarytool profile named `ardia`:
  `xcrun notarytool store-credentials ardia --apple-id <id> --team-id U5L5T3NGVV` (it asks for an
  app-specific password). Without it, the script still builds and signs, but the release is unnotarized and
  Gatekeeper blocks the first launch.
- The engine: ArdiaCore's `Chromium Framework.framework` built in `~/chromium-build` (`scripts/agent/engine-build`;
  `docs/engine-build.md`), and `pod install` in `apps/browser/macos`. A framework built elsewhere goes in through
  `ARDIACORE_FRAMEWORK`. That skips the tree checks and ships no engine archive, unless `ARDIACORE_FRAMEWORK_ENGINE`
  names the `engine/` git tree it was built from (`git rev-parse HEAD:engine`, checked against HEAD). Then the
  release packs that engine, and its source when it's Helium, as a build from the tree would.

## Cutting a release

1. Bump `MARKETING_VERSION` (the version) and `CURRENT_PROJECT_VERSION` (the build number, which Sparkle
   compares: it must go up every release) in both configurations of the `Ardia-macOS` target in
   `apps/browser/macos/Ardia.xcodeproj`. The helpers and the Dock tile plug-in take the same values.
2. Write `docs/release-notes/<version>.md` from `git log v<previous>..HEAD` (`docs/release-notes/README.md`)
   and check it on the site: `pnpm -C apps/site build && pnpm -C apps/site preview`, then
   `http://localhost:4321/release-notes#<version>`.
3. Commit both ("Release <version>" or "Nightly <version>"), push, and dispatch the Release workflow ("CI releases"
   below), which runs the rest. Or run it here: `scripts/release.sh <version>` (`--channel nightly` for a
   nightly). It stops right away if the notes file is missing or lacks its `date` and
   `headline`, if the tree under `apps/browser`, `packages`, `engine` or `scripts/dmg` has uncommitted changes, or if the engine
   framework is older than the tree's ArdiaCore sources or the Chromium tree differs from `engine/ardiacore`
   (`apply.sh --check`), if the version doesn't fit the channel or the notes' `channel`, if it can't read the published
   appcast, or if the build number isn't above every build in it. It writes `dist/<version>/`:
   - archives the Release configuration of `apps/browser/macos` for arm64, staging the engine into its own derived
     data so a development build restaging can't change it mid-build, and exports it with Developer ID. Here the export is Xcode's
     (`-allowProvisioningUpdates`, which needs Xcode signed in to the team); with `RELEASE_PROVISIONING_PROFILE` set (CI)
     the archive is signed ad hoc (`AdHoc.xcconfig`) and `scripts/lib/export-developer-id.sh` does the export: it embeds
     that profile and re-signs inside out with Developer ID, the same identifiers, entitlements, flags and designated
     requirements Xcode's export gives (`xcodebuild -exportArchive` refuses an Xcode-managed profile with manual signing),
   - leaves out what Ardia never loads (`packages/ardiacore/scripts/prune-bundle.sh`, after `strip-engine.sh`): Chrome's
     locales other than English and the app's own languages (Chrome takes its locale from the app bundle's
     localizations, and Ardia has none, so it runs in en-US whatever the Mac's language), SwiftShader and its Vulkan
     loader (WebGL and WebGPU run on Metal; Chrome dropped SwiftShader's WebGL fallback), Chrome's first-run sounds
     and pictures inside `resources.pak` (blanked by hash, `first-run-resources.sha256`; Ardia always passes
     `--no-first-run`), uBlock Origin's other locales, React Native's `@3x` images (Macs draw at 1x or 2x) and hermes's
     local symbols. Each step has a kill switch: `ARDIA_PRUNE_LOCALES`, `ARDIA_PRUNE_SWIFTSHADER`,
     `ARDIA_PRUNE_FIRST_RUN`, `ARDIA_PRUNE_UBO_LOCALES`, `ARDIA_PRUNE_RN_3X`, `ARDIA_STRIP_HERMES` (or `ARDIA_PRUNE` for
     all) set to `off`. Chrome's opt-in software GPU modes are unsupported in a release build: with
     `--use-angle=swiftshader`, `--enable-unsafe-swiftshader --disable-gpu` or WebGPU's
     `requestAdapter({forceFallbackAdapter: true})` under `--enable-unsafe-webgpu`, WebGL and WebGPU are unavailable
     (chrome://gpu says Disabled, the adapter is null) while pages, video and the GPU process carry on, with no crash or
     restart. The prebuilt engine archive is packed from a copy taken before pruning, so a checkout that fetches it
     gets every locale, SwiftShader and the first-run resources, and the kill switches work there too,
   - signs Chrome's framework inside out as Chrome signs its own (`chrome/installer/mac/signing/parts.py`): the
     helpers under the hardened runtime with library validation, except the renderer and GPU ones (Aperitif's too),
     which get `allow-jit` (`packages/ardiacore/scripts/signing`) instead; then the framework, then the app again with
     the entitlements the export gave it,
   - checks what an in-place update depends on: bundle id `com.ardia.browser`, executable `Ardia`, the
     designated requirement (our team), the keychain groups, Sparkle's feed and key and the usage strings in
     `Info.plist`; that every piece of code is Developer ID with a timestamp and no `get-task-allow`; and that the app
     is signed with `com.apple.developer.web-browser.public-key-credential` exactly when its provisioning profile
     grants it. Apple hasn't granted it yet; once it has, a `RELEASE_PROVISIONING_PROFILE` downloaded again carries it
     and the export signs with `Ardia-ICloudPasskeys.entitlements` on its own (the Xcode-managed export still needs
     `CODE_SIGN_ENTITLEMENTS` switched to that file),
   - launches the app once in the background (throwaway data dir), waits for uBlock's rulesets to be indexed,
     quits it and checks the signature again: the app must never write into its own bundle,
   - notarizes and staples the app and the DMG,
   - packages the DMG (lzma in 4 MB chunks, `udif-chunk-size=8192`, hdiutil's largest; `ARDIA_DMG_CHUNK=off` goes back
     to its 1 MB default) and the zip, and signs `appcast.xml` (`generate_appcast` names the feed after the app's
     `SUFeedURL`, so release.sh passes it `-o`) with the Sparkle key. It starts from the
     published appcast, so earlier versions and the other channel's items stay listed; a nightly's item gets
     `<sparkle:channel>nightly</sparkle:channel>`. The new item embeds the notes' headline and body
     (Markdown, shown in Sparkle's update dialog) and links the page as its full release notes
     (`sparkle:fullReleaseNotesLink`: "You're up to date" › Version History opens it in a tab),
   - copies `LICENSE*` and `NOTICE` into `Contents/Resources/Licenses` before signing, and checks they're there,
   - writes `release-notes.md` (the notes' body, then the standard Install and Source sections) and
     `provenance.txt` (the commit and the engine build it shipped).

   `scripts/release.sh <version> --rc` builds a candidate into `dist/<version>-rc/` from the working tree, as
   `<version>` with the next build number, notarized but never published: no notes file or clean tree needed (it
   lists the uncommitted files it included).
4. Tag and publish (the Release workflow does this itself): `git tag v<version> && git push origin main v<version>`,
   then `.claude/skills/release/scripts/publish.sh <version>` (`--dry-run` prints what it would do). It merges the
   appcast onto the feed as published right now (`appcast-merge.sh`), creates the release (a stable one as latest, a
   nightly as a prerelease that's never latest) with the DMG, zip, appcast, CLI tarball and a local engine archive,
   and checks the feed lists the version on GitHub and on ardia.dev. A nightly also re-uploads the merged feed onto the
   latest stable release and `Ardia-Nightly.dmg` onto the `nightly` release. With an engine packed here, append
   `dist/<version>/prebuilt-engine.tsv` to `packages/ardiacore/prebuilt-engines.tsv` and commit it. Last,
   `update-tap.sh <version>` points the Homebrew tap's `ardia` or `ardia@nightly` cask
   (https://github.com/mantrakp04/homebrew-tap) at the new DMG: it sets `version` and `sha256` from GitHub's
   digest of the published DMG and pushes the tap (`PUBLISH_TAP=0` skips it).
5. Deploy the site so `/release-notes` shows the new version (for a nightly too: the updated app opens its entry) (the updated app opens it on its first launch):
   `pnpm -C apps/site run deploy` builds `apps/site` with `SITE_URL=https://ardia.dev` and ships it
   (`infra/site/hexclave.deploy.ts`). Also bump `VERSION` and `DMG_SIZE` in `apps/site/src/data/release.ts`
   first so the download button points at the new DMG. The owner has authorized releases to go all the way
   through, so an agent cutting a release deploys too; a site deploy outside a release needs the owner's OK.

Before publishing, run the smoke test: `.claude/skills/release/scripts/smoke.sh <version> <previous> [--rc]` (the
`release` skill runs the whole flow). Besides the hidden launch over CDP, it checks the update itself against
`dist/<previous>/export`: the identity Sparkle, the keychain and TCC compare (bundle id, executable, feed, key, the
previous build's designated requirement, a higher build number), the appcast's EdDSA signature of the zip, Gatekeeper
on the app and the DMG, Sparkle actually updating a copy of the previous build (`update-test.sh`) and the previous
build's data opening in the new one (`carryover.sh`). By hand, check the build the way the script can't: launch
`dist/<version>/export/Ardia.app` with `ARDIA_BACKGROUND=1`, a throwaway `ARDIA_DATA_DIR` and
`ARDIA_REMOTE_DEBUGGING_PORT`, and load a page over CDP. Afterwards `codesign --verify --deep --strict` must still
pass on it.

To check the after-update tab too: in that data dir, set `lastVersion` in `release-notes.json` to the
previous version (`{"version":1,"lastVersion":"<previous>","pending":null}`) and relaunch with
`ARDIA_INSTANCE=releaseNotes` added (test instances skip the tab without it). `curl localhost:<port>/json` must
list one `…/release-notes#<version>` page; a second launch opens none.

## CI releases

`.github/workflows/release.yml` is the release pipeline, run by hand only (Actions › Release › Run workflow, or
`gh workflow run release.yml -f version=<version> -f channel=nightly|stable -f dry_run=false`). It
releases the commit it runs on, so first commit and push the version bump and the notes (steps 1 and 2), and publish
the engine if `engine/` changed (below).

- **preflight** checks the version against the channel, `MARKETING_VERSION`, the notes file and that `v<version>` isn't
  out yet.
- **checks**: `pnpm typecheck`, `pnpm test`, `pnpm shaders:check`.
- **build**, on the `xcode-27` runner (Xcode 27.1, the same build as here), with no secrets: fetches the engine for
  this exact `engine/` tree (`fetch-engine.sh`), installs (pnpm, Pods, uv), runs
  `scripts/release.sh <version> --channel <channel> --phase build` (the archive, signed ad hoc, and the CLI tarball)
  and uploads them as one tar. Caches: pnpm, Pods with Hermes, uBO, the engine, the CLI's downloads and Xcode's
  compilation cache (per Xcode build and month).
- **sign** installs nothing and restores no cache, so no dependency code runs next to the keys. It
  treats the build as untrusted: `.github/release/unpack-build.py` unpacks it into a new directory outside the checkout
  only if every member is the archive, `provenance.txt` or the CLI tarball and its `.sha256`, with no absolute or `..`
  path, hard link, device or path through a symlink, and every symlink resolving inside its own app or dSYM bundle;
  the app's bundle id, executable and version must be `com.ardia.browser`, `Ardia` and the input version.
  `release.sh --phase sign` reads it from there (`RELEASE_BUILD_INPUT`) into a `dist` it creates fresh, and the export
  takes the expected bundle id as an argument instead of reading it from the build. It takes Sparkle's tools from Sparkle's own 2.9.6 release (SHA-256 pinned; `SPARKLE_BIN`), sets up
  signing (`.github/release/signing.sh`: a temporary keychain with the Developer ID identity, the provisioning profile,
  the notary and Sparkle key files), and runs `release.sh … --phase sign`: export, sign, verify, notarize and staple the
  app, the zip and DMG (the DMG signed, notarized and stapled too), the notes and the appcast. Then a step written in
  the workflow itself (so nothing in the job can rewrite it) deletes the keychain and every key file, a check fails the
  run if the checkout changed, and only then it runs the launch check (`--phase check`, the final app opened hidden, uBO
  must be ready, the signature must survive), checks the zip's EdDSA signature against the app's `SUPublicEDKey`
  (`.github/release/check-sparkle.sh`) and uploads the DMG, zip, appcast, notes and CLI tarball. A failed launch check
  fails the run, so nothing publishes.
  Every `actions/*` step is pinned by commit SHA.
- **publish** tags the commit and runs `publish.sh`. Before creating anything, `publish.sh` refuses a build that isn't
  above every other build in the merged feed, and a stable whose version isn't above the
  latest stable release, so a stale build never moves `latest` backward (locally too). Local and CI publishes share one
  lock, the branch `release-lock` (created atomically through GitHub's API, its commit message naming the holder and
  the time): `publish.sh` takes it before it reads the latest release and the feeds and gives it back on exit, so two
  publishes can't build on the same snapshot. A second publish meanwhile stops, naming the holder; a lock older than
  2 h (a publish that died) is broken only with `--break-lock`, and only when its holder and time can be read. Taking
  it creates the branch through a push that must find no branch there; breaking and releasing it are pushes that only
  succeed while the branch is still the commit they expect (`--force-with-lease`, checked by GitHub), so nobody can
  remove a lock someone else holds. Dry runs take it too, and write nothing else; `PUBLISH_LOCK` renames it for dry
  runs only. The staged-rollout step that opens a release to everyone (`rollout-everyone.sh`, in the release skill)
  takes the same lock. The Homebrew tap needs a token that can push
  to `mantrakp04/homebrew-tap` (`HOMEBREW_TAP_TOKEN`); without it, run `update-tap.sh <version>` here afterwards.

`dry_run` (on by default) builds a release candidate (`release.sh --rc`: the next build number, no notes needed),
signed and notarized like a release, and runs `publish.sh --dry-run`: nothing is tagged or published. The site's `VERSION`, the landing page and the stable perf gate stay local (the release skill); the
site redeploys by itself when the notes are pushed (`.github/workflows/deploy.yml`).

Secrets (repository secrets, these names):

| Secret | What |
|---|---|
| `MACOS_CERTIFICATE_P12` | base64 of a .p12 with the Developer ID Application certificate and its key |
| `MACOS_CERTIFICATE_PASSWORD` | that .p12's password |
| `MACOS_PROVISIONING_PROFILE` | base64 of the Developer ID provisioning profile for `com.ardia.browser` (the keychain groups need it) |
| `NOTARY_KEY_P8` | base64 of the App Store Connect API key `AuthKey_<id>.p8` |
| `NOTARY_KEY_ID`, `NOTARY_ISSUER` | that key's id and issuer id |
| `SPARKLE_ED_PRIVATE_KEY` | the file `generate_keys -x` writes (as is) |
| `HOMEBREW_TAP_TOKEN` (optional) | a token that can push to `mantrakp04/homebrew-tap` |

A dry run without the notary secrets builds unnotarized; the others are required. `release.sh` reads the same
material from `RELEASE_PROVISIONING_PROFILE`, `SPARKLE_KEY_FILE` and `NOTARY_KEY`/`NOTARY_KEY_ID`/`NOTARY_ISSUER`, so
it can run that way here too; with none of them set it works as before (Xcode's export, the login keychain). Without
`--phase` it does everything in one go, in the same order as before; `--phase build|sign|check` are the CI's three
steps (the build with no keys, then signing and packaging, then the launch check once the keys are gone).

### Engines

The app links a prebuilt Chromium Framework, which a normal CI job can't build. It's built here
(`docs/engine-build.md`); after building it, `scripts/publish-engine.sh` (`--dry-run` first) packs it as release.sh
packs one (stripped, unpruned) with its Helium source, uploads both to the prerelease `engine-<engine tree:12>` (never
latest, so the feed and the download links never move to it) and appends `<tree> engine-<tree:12> <sha256>` to
`packages/ardiacore/prebuilt-engines.tsv`: commit and push that line before dispatching. A release whose `engine/`
tree has no engine fails its build at once, saying which script to run.

## The engine switch (0.2.21 → 0.2.22)

0.2.22 is the first release on ArdiaCore; 0.2.21 and earlier ran on CEF. It's the same app to macOS and Sparkle (bundle
id, executable, Developer ID team, designated requirement, feed and key), so Sparkle updates a CEF copy in place and
macOS keeps its permissions, keychain items and passkeys.

Nothing is migrated. A release build without `ARDIA_DATA_DIR` opens the CEF build's data where it is
(`InstalledDataDirectory` in `packages/ardiacore/ios/ArdiaProfiles.mm`): Chrome's user data dir
`~/Library/Application Support/com.ardia.browser/Chromium` (profiles `Default` and `Profile <id>`), with the app's
own documents (session, settings) in the folder above. Both engines are Chromium 154.0.8037.58, so every store keeps its
format, and both read the same "Ardia Safe Storage" keychain item, which trusts the app by its designated
requirement. Only Developer ID builds use the login keychain; test instances (`ARDIA_DATA_DIR` or
`ARDIA_BACKGROUND`) and ad hoc builds use Chrome's mock keychain. `carryover.sh` checks it: the previous build makes
two profiles with tabs, persistent and session cookies, localStorage, saved passwords, bookmarks, history, an address,
a site permission, a zoom level and an unpacked extension, and the new build, started without `ARDIA_DATA_DIR`,
must find and read all of it. Saved passwords are shown only after macOS re-authentication, which a hidden instance
grants only as the `ARDIA_TEST` `reauth=granted` fake, and that counts only in a test instance (a scratch
`ARDIA_DATA_DIR`), so the new build reveals them in a second launch on the same folder named as `ARDIA_DATA_DIR`. Both run as test copies (bundle id `com.ardia.browser.carryover`, signed ad hoc) in
a fake home (`HOME` and `CFFIXED_USER_HOME`), so the real app's data, defaults and keychain are never touched.
`rollback.sh <previous app> <new app>` (not part of smoke.sh) checks going back on the same setup: the previous build,
then the new one adding a second session, then the previous one again must show both sessions' data without crashing
or resetting the profile. 0.2.21 → 0.2.22 → 0.2.21 keeps everything but session cookies, which 0.2.21 drops at every
launch anyway.

`update-test.sh` runs Sparkle itself: the previous build's `Sparkle.framework` (through `sparkle-host.swift`) reads a
local feed made of the release appcast's own item, downloads the zip, checks its EdDSA signature, extracts it and runs
Sparkle's installer, which swaps a scratch copy of the previous build for the new one, silently and without
relaunching it. The copies get a test bundle id and a throwaway key, so neither the real defaults nor the release key
are involved; the real identity and signature are what smoke.sh's other update checks compare.

The framework and its helpers keep Chrome's names (`Chromium Framework`, `Chromium Helper (Renderer)`): they are
compiled in from the branding file, so renaming them is a full engine rebuild. Their bundle ids and team are ours,
and the keychain and macOS permissions belong to the app itself, so only Activity Monitor shows the names. Their
icon is Ardia's (the Alerts helpers' shows on every notification): `engine/chromium` replaces Chromium's logo.

## The rename (0.2.32 → 0.2.33)

Netnyahoo became Ardia. 0.2.32 and earlier are `com.netnyahoo.browser`, executable `Netnyahoo`, polling
`https://netnyahoo.com/appcast.xml`; 0.2.33 is `com.ardia.browser`, `Ardia` and `https://ardia.dev/appcast.xml`. What
Sparkle still needs stays: the EdDSA key, the Developer ID team and certificate, and a higher build number. The update
zip's top folder keeps the installed name (`Netnyahoo.app`: Sparkle finds the new app only under it), and at its first
launch the app renames itself to `Ardia.app` and moves its data, keychain items and settings across
(`packages/sync/ios/Core/LegacyMigration.swift`, the only Swift file that spells the old names). A Dock tile pinned under the old name is pointed at Ardia.app in place (or dropped when Ardia is pinned too) and the Dock restarted, once, by the installed copy only (`LegacyDockTile.swift` beside it; 0.2.35). `smoke.sh` checks both
feeds lead to the same appcast and the designated requirement holds under the new id; `update-test.sh` keeps the
bundle ids apart; `carryover.mjs` drives the old build in its own names. netnyahoo.com stays attached to the site for
good (`infra/site/hexclave.deploy.ts`).

## Unnotarized builds

Releases are notarized since 0.2.1 (the `ardia` profile holds an App Store Connect API key; with an
Apple ID it's `--apple-id … --team-id …` and an app-specific password, which also works but locks the
Apple ID after repeated failures). If a build ever ships unnotarized, Gatekeeper refuses to open the download. Either open it once from System Settings › Privacy &
Security › Open Anyway, or run `xattr -dr com.apple.quarantine /Applications/Ardia.app`.
