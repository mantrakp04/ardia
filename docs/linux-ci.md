# Linux CI

Linux CI follows the Mac's prebuilt-engine model. Chromium is compiled only on a Linux builder. GitHub Actions fetches
a published, checksum-verified engine, builds the current `apps/linux` UI, packages it and smoke-tests the package.
Hosted CI never runs `gclient sync`, GN or a Chromium build.

## Pieces

| Piece | What it does |
| --- | --- |
| [`.github/workflows/linux.yml`](../.github/workflows/linux.yml) | Manual (`workflow_dispatch`) workflow with a `checks` job and a `package` job, both on `ubuntu-24.04` |
| [`.github/actions/linux-setup`](../.github/actions/linux-setup/action.yml) | Ubuntu packages for the fixtures (clang, dbus, NSS tools, gnome-keyring, PyGObject), Node 24, pnpm and `pnpm install --frozen-lockfile` |
| [`scripts/linux/ci-checks.sh`](../scripts/linux/ci-checks.sh) | The engine-free checks; the `engine/ardiacore-linux/tests` modules run in parallel because the suite takes well over five minutes serially |
| [`scripts/linux/publish-engine.sh`](../scripts/linux/publish-engine.sh) | Builder side: stages, strips and archives an engine from a Chromium out dir; `--upload` publishes it and adds its table row |
| [`packages/ardiacore/prebuilt-engines-linux.tsv`](../packages/ardiacore/prebuilt-engines-linux.tsv) | `tree<TAB>tag<TAB>sha256` for each published Linux engine |
| `packages/ardiacore/scripts/fetch-engine.sh --arch linux-x86_64` | Dispatches to [`scripts/linux/fetch-engine.sh`](../scripts/linux/fetch-engine.sh); the Mac path is unchanged |
| [`scripts/linux/runtime_files.py`](../scripts/linux/runtime_files.py) | The one runtime allowlist used by publishing, fetching and packaging, and the safe archive unpacker |
| [`scripts/linux/smoke.mjs`](../scripts/linux/smoke.mjs) | Strict smoke gate for a packaged tarball |

## Engine archives

- **Key.** The engine is keyed by `git rev-parse HEAD:engine`, as on the Mac.
- **Archive.** `ArdiaCore-<tree12>-linux-x64.tar.xz` holds one directory, `ardiacore-linux-x64/`. It contains the
  allowlisted runtime files and a `manifest.json`: engine tree, source commit, Chromium version, `args.gn` hash,
  chrome hash and build ID, and build and packaging times.
- **Where it's published.** It is attached to an `engine-<tree12>` prerelease in `$ARDIACORE_PREBUILT_REPO`, with a
  `.sha256` beside it. The scripts and the workflow default to `mckamyk/ardia`, where the Linux engines are published.
  Set the `ARDIACORE_PREBUILT_REPO` repository variable to use another repository.
- **What it ships.** The allowlist ships only what Chromium loads at runtime. It leaves out `.so.TOC` files, the mock
  Vulkan driver, the Vulkan validation layer and `locales/*.pak.info`.
- **Stripping.** The publisher strips a staging copy; `symbol_level=0` builds have no debug symbols to keep. `chrome`
  shrinks from about 535 MB to about 300 MB, and the archive is about 110 MB.
- **Source commit.** The publisher doesn't trust `repo.commit` alone. It computes the git tree of the source copy's
  `engine/` and records `source_commit` only when that commit's `engine/` tree matches.
- **Out dir.** The publisher copies from the out dir while holding the chromium lock and never writes there.

Publishing an engine for the current build:

```bash
source engine/patches/build/env.sh
scripts/linux/publish-engine.sh \
  --out "$CB/chromium_git/chromium/src/out/$GN_OUT_CONFIGS" \
  --source <the Ardia checkout the engine was built from> --upload
git add packages/ardiacore/prebuilt-engines-linux.tsv
```

Without `--upload` it only writes the archive and prints its table row.

The fetcher checks an archive in this order:

1. it verifies the SHA-256 before unpacking;
2. it rejects entries outside `ardiacore-linux-x64/`, links pointing outside it, and special files;
3. it checks the manifest's tree and platform;
4. it moves the engine into `apps/browser/build-ardiacore/prebuilt-linux-x86_64/<tree12>/`, and marks it complete
   last.

It reads the local table first, then the cache, then the published table on the `linux` branch, so CI on an older
commit still finds engines published later.

## Nearest engine for CI, exact engine for releases

`engine/` changes in many commits, and many of those changes are Mac-only. Requiring an exact engine would leave the
package job red after almost every merge.

- **Nearest.** The workflow defaults to `--nearest`, the same option the Mac fetcher has. It uses the engine of the nearest
  earlier commit that changed `engine/`, within the last 200 such commits. The job warns, the summary names both
  trees, and the artifact is named `Ardia-linux-x64-<commit12>-engine-<engine12>`.
- **Exact.** Choose `exact` when a package must match its source. A Linux release requires it.
- **Keeping nearest close.** Publishing after each `engine/` change on the builder keeps nearest builds close.

## Jobs

- **`checks`.** It needs no engine. It runs:
  - the `apps/linux` typecheck, host, symbol, module-graph and acceptance self-tests;
  - the UI build;
  - the Python and Node suites under `engine/patches/build/tests`, `engine/chromium/src/chrome/browser/ardia/tests` and
    `engine/ardiacore-linux/tests`.

  On failure it uploads every check's log.
- **`package`.** In order, it:
  1. fetches the engine (cached per tree and table);
  2. builds `apps/linux/dist`;
  3. prepares uBlock Origin with `scripts/linux/fetch-ubo.sh` (cached);
  4. runs `scripts/linux/package.py --out <engine>`;
  5. runs the smoke gate;
  6. uploads the tarball, its SHA-256 and `results.json` for seven days.

  Its apt list covers the libraries `chrome` links (`readelf -d`) plus GTK and libsecret, which it loads at runtime.

The Ubuntu compatibility risk is small. The engine builds against Chromium's own sysroot (`use_sysroot=true`), and
`chrome` needs at most GLIBC 2.25.

## Smoke gate

`node scripts/linux/smoke.mjs --package <tar.xz> --results <dir>` extracts the tarball and launches `bin/ardia`:

- with headless Ozone and SwiftShader;
- with `ARDIA_BACKGROUND=1`;
- with a throwaway profile;
- without `--ardia-ui-dir`.

It refuses any sandbox-disabling switch. Every check must run and pass:

1. `ldd` resolves every library.
2. The `chrome://ardia/` shell renders, and its assets are byte-identical to the packaged UI.
3. The bootstrap reports `appBuild=linux-host`.
4. A native tab loads a local HTTP fixture, paints it, and the page cannot see `__ardiaHost`.
5. Every renderer runs under seccomp in its own user and pid namespace.
6. The shipped uBlock Origin and its Linux bridge are present and the content blocker reports ready.
7. A clean quit and relaunch restores the tab.
8. `install.sh --destdir` stages the launcher, desktop entry, chrome, UI and polkit policy with the right modes.

It takes about 8 s and writes `results.json` and the launch logs.

A headless smoke can't cover focus, GPU, keyring or desktop dialogs, and no automated check here does. The headless
acceptance suite ([linux-acceptance.md](linux-acceptance.md)) runs by hand.

## Sandbox on Ubuntu

- **The restriction.** Ubuntu 24.04 limits unprivileged user namespaces through AppArmor
  (`kernel.apparmor_restrict_unprivileged_userns=1`). The package ships no SUID `chrome_sandbox`, so Chromium refuses
  to start rather than run unsandboxed.
- **In CI.** The workflow lifts the restriction on its throwaway runner before the smoke step and never passes
  `--no-sandbox`.
- **For users.** Users on Ubuntu 24.04 hit the same restriction. The package needs an AppArmor profile, as Chrome's
  `.deb` ships, before it is usable there.

## Turning on automatic runs

The workflow runs only when started by hand. To run it on every change:

1. Publish an engine with `publish-engine.sh --upload` and commit the table row.
2. Run the Linux workflow from the default branch, inspect the artifact and measure the jobs.
3. Add `pull_request` and `push` triggers on these paths:
   - `apps/linux/**`, `apps/browser/**`, `packages/**`, `engine/**`, `scripts/linux/**` and `patches/**`;
   - the workspace manifests and lockfile;
   - the workflow itself.
