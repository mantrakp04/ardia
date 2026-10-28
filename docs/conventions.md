# Conventions

How Ardia's code is laid out and written. `apps/browser/src/conventions.test.mjs` enforces most of it (see
[The check](#the-check)); the rest is on review.

## Backwards compatibility: migrations only

The app and its engine ship together (a release bundles its engine; a dev build fetches the prebuilt engine matching
its commit's `engine/` tree), so code never tolerates a mismatched engine.

- No `respondsToSelector` guards for ArdiaCore's API, no optional `?.()` native calls, no always-true `isAvailable`
  checks, no metadata probes, no aliases for old names, no duplicate overloads. Keep `respondsToSelector` only for
  private AppKit or Chromium classes looked up at runtime.
- What stays: versioned on-disk data migrations (Netnyahoo → Ardia included), the versioned sync payload (a nightly Mac
  syncs with a stable Mac a version behind), and the one app/engine version assertion: `NATIVE_API_VERSION` and
  `apiVersion` in `packages/shell/ios/AppModule.swift`. Bump both when the native surface changes.

## Folders and import direction (`apps/browser/src`)

```
App.tsx, main.tsx       entry points
components/ui/          design system: pieces, tokens, motion, wrapped native views
components/<feature>/   sidebar, tabstrip, omnibox, downloads, settings, import, onboarding, …
state/<domain>/         tabs, windows, profiles, bookmarks, history, downloads, settings, engines, extensions, sync, …
platform/               the only code that calls native modules
lib/                    pure helpers: url, time, keys
```

| From | May import |
| --- | --- |
| `components/<feature>` | `components/*`, `state`, `lib` |
| `components/ui` | `components/ui`, `lib` |
| `state` | `state`, `platform`, `lib` |
| `platform` | `platform`, `lib` |
| `lib` | `lib` (nothing else in the app) |

- Only `platform/` imports native packages (`@ardia/ardiacore`, `@ardia/shell`, `@ardia/shaders`, `@ardia/import`,
  `@ardia/sync`), `expo-modules-core` or `NativeModules`. `components/ui/` may import native *views* to wrap them.
- `platform/<domain>.ts` holds one domain's native functions and types (`platform/downloads.ts`, `platform/menus.ts`,
  `platform/windows.ts`, …), re-exported as the packages define them, so a call returns and throws exactly what the
  native API does. A name lives in one platform module.
- Components never call native functions; they call actions in `state/`. Where the action is the native call itself,
  the domain re-exports it: `state/app/system.ts` (menus, alerts, prompts, the clipboard, haptics, files, external
  URLs), `state/app/appSettings.ts`, `state/windows/nativeWindow.ts`, `state/downloads/actions.ts`, … Native views
  come from `components/ui`.
- Components never import `platform/`. A platform value a component uses (a web view handle, a kill switch, the
  import module) reaches it as a re-export from its domain in `state/`: `state/tabs/webviewHandles.ts`,
  `state/tabs/prewarm.ts`, `state/app/switches.ts`, `state/app/slowTimers.ts`, `state/app/nativeApiSkew.ts`,
  `state/import/importApi.ts`, and `isWebDemo` from `state/onboarding/demoSteps.ts`. Each re-export file imports
  only its platform module, so modules still load in the same order.
- The one exception is the dev harness (`components/dev/devHarness.ts`): it hands the whole shell module to CDP
  scripts as `ac.shell` (`platform/devShell.ts`), with the documents, engine, web view and preload modules beside it.
  The check exempts that file by name (`HANDS_PLATFORM_TO_SCRIPTS`), not the `components/dev/` folder.
- Nothing lives outside these folders except the entry points.

## UI

- **Values come from tokens.** `components/ui/tokens.ts` holds the colour roles (light and dark), spacing scale,
  radii, type, shadow levels; `components/ui/motion.ts` holds the motion presets (named curves and the one spring
  converter). A Dia-measured value used in one place is a named constant in its feature's `tokens.ts`.
- **One role per look.** Before adding a colour or shadow, use the role that already draws it; a feature palette
  points at a shared role (`colorRoles.dark.destructive`) instead of copying its value. User-picked colours (profile
  and tab group palettes) are data, not roles. The shared roles that replaced lookalikes (2026-10-26):

  | Role | Dark / light | For |
  | --- | --- | --- |
  | `accent` | #4A77D4 / #6395FC (Dia's CommandBar blue) | chrome and popovers: drop rings, progress, links, popover toggles and checkmarks, live unread dots |
  | `formAccent` | #0A84FF / #007AFF (system blue) | AppKit-style controls in settings, dialogs and pages: primary buttons, checkboxes, radios, form switches, selection |
  | `destructive` | #FF453A / #FF3B30 | every danger, error, failing and recording red |
  | `warning`, `success` | #FF9F0A / #FF9500, #30D158 / #34C759 | amber notices and conflicts; done, passing, default |
  | `rowHover` | white / black 0.07 (Dia's Menu/ItemBackgroundHovered) | every row hover: sidebar, menus, popovers, settings, pages |
  | `divider` | white / black 0.09 (Dia's Primitives/Primary1200) | every separator line; the top strip's group divider and the site-coloured toolbar keep their own |
  | `panel` | #2A2A2A / #FFFFFF (Dia's command panel) | opaque panels, dialogs, cards, the media players |
  | `tooltipFill` | #262626 / #FFFFFF (Dia's tooltip) | tooltips; `popoverFill` and `popoverTint` are its colour at the menu material's alphas |
  | `onPrimary` | #000000 / #FFFFFF | ink on a filled pill or badge (Go, chip primary, onboarding primary, badges) |
  | `shadow.dialog` | 24 pt, (0, 10) | dialogs, sheets, the command panel, NTP cards (with their own opacity); `shadow.popover` (18, (0, 8)) is the lighter menu-material level |
- No hex, `rgb()`/`rgba()`/`hsl()` literals, `Easing.` curves or numeric animation durations outside files named
  `tokens.ts` or `motion.ts`.
- **Screens are built from `components/ui/` pieces:** Box, Text, Button (icon, text, pill and close variants),
  Popover, Dialog, Row, Field, Switch, Radio, Menu, with token props (`pad="m" fill="panel" radius="l"`). Native views
  (Surface, Symbol, the web view, …) are wrapped there too. Feature code passes `style` only for layout (flex,
  position, size) and animated values.
- One copy of each piece. Before writing a button, panel, closing animation or `hostOf`, use the one in
  `components/ui/` or `lib/`.
- Import pieces from the `components/ui` index (`import { Button, Popover } from "../ui"`). Inside `components/ui`,
  modules import each other directly.

### Which piece replaces what

| Hand-built today | Use |
| --- | --- |
| `theme.dark ? "rgba(…)" : "rgba(…)"` | a role on the theme (`theme.popoverBorder`, `theme.scrim`, …), added to both palettes in `tokens.ts` |
| `useFormColors().accent` and friends | the theme role: `formAccent`, `groupFill`, `control`, `field`, `destructive`, `searchFlash`, … (`useFormColors` stays only until its callers move) |
| `Easing.out(Easing.quad)`, `Easing.bezier(…)` | `curve.outQuad`, `curve.fade`, `curve.fold`, … from `motion.ts` |
| a numeric `duration:` shared with another place | `duration.popoverOpen`, `duration.fade`, `duration.slide`, … |
| `stiffness: (2π/response)²` written by hand | `spring({ response, damping })` |
| a `View` with `padding`/`gap`/`backgroundColor`/`borderRadius` from tokens | `<Box pad="m" gap="s" fill="panel" radius="card" row>` |
| `<Text style={{ fontSize: 13, fontWeight: "600", color: theme.textSecondary }}>` | `<Text size="body" weight="semibold" tone="textSecondary">` |
| a pressable square with an SF Symbol and a hover plate | `<Button variant="icon" icon="…">` (add `toolbar` for toolbar buttons: modifier clicks, long press, context menu, no window drag; `palette` for site-coloured toolbars) |
| a hover-plated text link ("Replace", "Clear", "Skip Tour") | `<Button variant="text" title plate="toolbar" \| "hover" \| "none">` |
| a filled rounded button with a title | `<Button variant="pill" tone="prompt" \| "chip" \| "control" primary>` |
| a dismiss ✕ | `<Button variant="close" look="panel" \| "hud" \| "art">` |
| a macOS push button (settings, dialogs) | `<Button title kind="default" \| "primary" \| "destructive" \| "plain">` |
| a menu-material panel with a scale-in | `Popover` (or `PopoverSurface` for the material alone); a panel placed by its own math uses `usePopoverMotion` + `usePopoverMotionStyle`; open/close state from `usePopoverPresence` |
| a row in a popover or menu | `MenuRow` and `MenuSeparator` |
| a `Surface` with a fill, corner radius, hairline border and shadow (cards, ghosts, HUDs) | `<Panel fill radius border shadow={level}>`; the level is a `ShadowLevel` from `tokens.ts` or the feature's `tokens.ts` |
| a centred modal over a scrim | `<Dialog width pad onDismiss>`; anchored to a spot with `place={{ top, right }}`; `Sheet` is the settings preset |
| a settings row / grouped rows | `Row` and `Group`; inside settings, `Row`, `SectionHeader` and `Anchor` from `components/settings/Form` add the search anchor |
| a text input / search box / pop-up menu / checkbox | `TextField`, `SearchField`, `PopUp`, `Checkbox` |
| an on/off switch | `<Toggle>` (settings) or `<Toggle look="panel">` (popovers) |
| a radio dot | `<Radio on look="form" \| "compact" \| "ring">` |
| a colour swatch with a selection ring | `<Swatch selected ring fill>` (children instead of `fill` for a gradient) |

## State

- Hover, pressed and open state of one component stays in that component's `useState`.
- Anything two components share, or anything saved to disk, lives in `state/<domain>/`: the store slice, its `useX()`
  selector hooks, its actions, and the effects that keep it in sync with the engine.
- Components read through `useX()` hooks and write through actions. Never `getState()` in a component.
- One way to create a store. Saved data has versioned migrations.

**One store shape.** A store holds data only, and the functions that change it are exported next to it:

```ts
export const useClearDataRequest = create<{ windowId: string | null }>()(() => ({ windowId: null }));

export const requestClearData = (windowId: string | null) => useClearDataRequest.setState({ windowId });
```

- Always the curried `create<T>()(() => init)`, never a store with methods inside or a `set`/`get` creator.
- `setState` is called only in `state/`, by the store's own domain (`state/<domain>/`). Other domains and components
  call that domain's exported actions.
- A store used by one component tree still lives in `state/<domain>/`. Only a store made per component instance
  (one per mounted provider) stays in that component.
- **The one exception is `useBrowser`** (`state/browser/store.ts`), the workspace store. Its actions stay methods,
  composed from slices (`createTabsSlice`, …), because the store tests (`S().newTab(…)`) and the scripts that drive
  a running app over CDP (`ac.store.getState().newTab(…)` in acceptance, the release smoke test and the perf benches)
  call them there. Components never call them on the store: each domain's `actions.ts` exports them as functions
  with `storeAction("newTab")`, next to the domain's own UI actions (dialogs, confirmations).

**Reads.** Components subscribe through hooks from `state/<domain>/hooks.ts`, never `useBrowser(…)` or a store's
`getState()`:

- A hook keeps the selector as narrow as the component needs: `useSettings((s) => s.tabLayout)`,
  `useTab(id, (t) => t?.title)`, `useWindow(id, (w) => w?.sidebarOpen)`. Pass `useShallow(…)` through when the
  selector builds an array or object. Moving a selector into a hook never widens it: a component re-renders exactly
  when it did before.
- A selector that combines domains, or that two components share, becomes a named hook (`useWindowProfile`,
  `useIsBookmarked`).
- An event handler that decides from the current state calls a reader exported from `state/` (`currentTab(id)`,
  `currentSettings()`), or better, an action that makes the whole decision in `state/`.

**UI from state.** `state/` never imports `components/`. When an action needs UI (a sheet, a menu anchored to a
view, an animation), state exposes a request (a store field or an event) and a component renders it.

**Saved documents.** Every JSON document the app keeps in its data folder carries a schema version and reads through
`lib/savedDocument.ts`:

```ts
const VERSION = 2;
const MIGRATIONS: Migrations = { 0: unchanged, 1: (doc) => ({ ...doc, downloads: doc.items }) };

const saved = parseSaved(readDocument(DOC), VERSION, MIGRATIONS);
writeDocument(DOC, versionedJson(data, VERSION));
```

- A shape change bumps `VERSION` and adds the step from the old version (`MIGRATIONS[n]` turns version n into
  n + 1). Never branch on the shape instead.
- A document without the field is version 0. A version newer than the app knows, a field that isn't a non-negative
  integer, a missing step, or anything that isn't a plain object reads as nothing (the document's defaults), and is
  overwritten on the next save. Downgrades aren't supported.
- `versionedJson` writes the version last, so the payload can't override it. The reader still checks the payload it
  depends on: a version says which shape to expect, not that the data is valid.
- The field is `version`, except in `sync.json` (`v`) and `ardia-cli.json` (`schemaVersion`; its `version` is the
  installed CLI's version).
- Covered: `session.json` (3), `downloads.json` (2), `launch-look.json` (2), `bookmarks-cache.json`, `telemetry.json`,
  `telemetry-queue.json`, `telemetry-daily.json`, `release-notes.json`, `onboarding.json`,
  `default-browser-offer.json`, `sync.json`, `sync-extensions.json`, `live.json`, `ardia-cli.json`,
  `bangs-state.json` and `Scripts/status.json` (all 1).
- Not versioned yet: the sealed `sync-state.nns` and `sync-journal.nns`. Each gets its own version in its envelope
  (`{ version, scopes }`, and inside the journal's `{ journal }`) before its first format change; `sync.json`'s `v`
  doesn't cover them, because they're written separately.
- Out of scope: the Keychain token JSON, logs (`dev-console.log`, `telemetry-requests.log`), dev and bench results
  (`dev-eval-result.json`, `layout-watch.json`), test fixtures (`calendar-fixture.json`), and the legacy
  `bookmarks.json` / `history.json`, which are migration inputs read once. The sync payload (log and snapshot files,
  `v: 1`) and `switches-cache.json` have their own versions.

## Files

- Components are `PascalCase.tsx`; every other module is `camelCase.ts`. Tests sit next to the code as
  `camelCase.test.mjs` (or `PascalCase.test.mjs` for a component).
- At most 400 lines per TS/TSX file (`apps/browser/src`, `packages/*/src`), 600 per native file (`packages/*/ios`,
  `engine/ardiacore/src`, `engine/chromium/src`). Tests, fixtures and generated files (`packages/core/src/bangList.ts`)
  are exempt, and so is `packages/ardiacore/ios/page_script.js`: it is injected as one closure into every frame, and its
  helpers share builtins captured before page code runs, so splitting it would need a bundling step. So is
  `packages/core/src/suggest.reference.ts`, the frozen spec the suggestion code was tuned against
  (`suggest.property.test.ts` holds the live code to it, `SUGGEST_BEFORE=1` benches it): it stays as written.
- One type per native file, named after it.
- No comments (AGENTS.md › Hard rules), including comments inside injected page JS and shader source held in strings.
  Allowed: license headers, shebangs and tool directives (`@ts-expect-error`, `eslint-disable`, `#pragma`,
  `swiftlint:`, `nogncheck`, `NOLINT`).

## Names

- App-side ObjC classes and their files are `Ardia<Thing>`; Swift types use plain names (the module namespaces them).
- The engine's exported ObjC API is `ArdiaCore*`; engine C/C++ is `ac_*`.
- No `Cef*`/`CEF`/`cef` names, no `AC*` or app-side `ArdiaCore*` classes in `packages/*/ios`.
- No `Netnyahoo` or `NN*` names outside migration code (`LegacyMigration.swift`, `legacy.ts`, `*Migration.swift`,
  `*migrations.ts`).

## Translation layer (JS ↔ Expo modules ↔ ArdiaCore ↔ `ac_*`)

- **One way to call the engine:** `engine.call("downloads.pause", args)`, typed from one table
  (`packages/ardiacore/src/engine/api.ts`); native dispatches by name to the matching `ac_*` call. Only secrets
  (`callWithSecret`) and views get dedicated functions.
- **One error model:** engine errors reject with `{code, message}` (`ERR_ENGINE`, `ERR_UNKNOWN_CALL`,
  `ERR_CONTENT_BLOCKER`, `ERR_BAD_REPLY`); JS throws `ArdiaError` with the code. Refused, absent or unavailable
  answers are values in the function's return type (`false`, `null`, `[]`), not errors. The bridge never falls back
  silently; callers decide (`orWarn(x)` in `lib/fallback.ts` logs and falls back).
- **One event channel per module.** Event names are `domain.event`; payloads are parsed once.
- **IDs at the API surface** are `tabId` (the app's string), `windowId` and `profileId`. Browser ids, transfer keys,
  adopt ids and Chrome's int tab ids stay internal, resolved by one native registry. Per-tab operations live on the
  tab's API.
- **One `PageEngine` protocol** for the Chromium and WebKit page engines: same method names, one event table.
- **One Expo module per domain** (`ArdiaTabs`, `ArdiaDownloads`, `ArdiaExtensions`, `ArdiaProfiles`,
  `ArdiaPermissions`, `ArdiaWindows`, `ArdiaMenus`, `ArdiaSystem`, …), each in `<Domain>Module.swift`, registered as
  `Ardia<Domain>`.
- ArdiaShell links ArdiaCore directly and calls it with types: no selector strings or string notifications between
  them.
- **One authority per rule:** the engine's off-the-record flag alone decides private profiles; one helper builds
  profile directory names.

## Environment variables

Read once, in one place: `ArdiaLaunchConfig` (`packages/ardiacore/ios`) reads the environment at start and JS gets it
from `platform/launchConfig.ts`. No `getenv`, `ProcessInfo…environment`, `base::Environment` or `process.env` anywhere
else in app or engine code (scripts and tests outside the app runtime are free to). The engine reads command-line
switches, never the environment: the app passes `--ardia-test=<list>`, `--ardia-trace=<list>`,
`--ardia-switches=<list>` and `--ardia-<instance key>=<value>` to `ChromeMain`.

Three engine lines are exempt, by file and exact line (`ENGINE_ENV_READS` in the check); any other read in those files
still counts:

| File | Read | Why |
| --- | --- | --- |
| `engine/ardiacore/src/ardia/core/ac_main_delegate.cc` | `base::Environment` in `EnvironmentThatOpensTheProfile` and `KeepRealProfileClosed` (2 lines, 3 reads) | The profile gate checks for `SSLKEYLOGFILE` and unsets it outside a mock-keychain instance, so nothing records the TLS keys of the real profile. It guards against the environment, so it has to read it. |
| `engine/chromium/src/chrome/browser/ardia/ac_scripts_policy.cc` | `getenv("HOME")` | Expands `~` in a user script path the way the shell does. |

| Variable | Value | What it does |
| --- | --- | --- |
| `ARDIA_DATA_DIR` | path | The instance's data directory |
| `ARDIA_BACKGROUND` | `1` | Hidden instance: never activates, windows sit behind the owner's |
| `ARDIA_REMOTE_DEBUGGING_PORT` | port | CDP port |
| `ARDIA_INSTANCE` | `key=value,…` | The few other instance settings (downloads dir, update feed, extra Chromium switches, …) |
| `ARDIA_SWITCHES` | `name=on,…` | The only feature toggle, backed by the registry `platform/killSwitches.ts`: kill switches (on by default, at most 8) and experiments (off by default), each with an owner and `removeBy` |
| `ARDIA_TRACE` | `pip,visibility,…` | Trace logging per area |
| `ARDIA_TEST` | `keychain=file,reauth=granted,…` | All test fakes and fixtures |

- `ARDIA_TEST` and `ARDIA_TRACE` work only in a test instance (not signed for distribution, a scratch data dir, the
  mock keychain); a release build ignores them and logs that once. CDP, argv and extra switches reach Chrome only with
  the mock keychain.
- An experiment ends by keeping the winning path and deleting the other branch and its toggle. One still being tried
  is an entry in the registry (`EXPERIMENTS`), not a new variable.
- Every key, area and value: `docs/agent-brief.md` › Launch variables.

## The check

`apps/browser/src/conventions.test.mjs` runs in `pnpm -C apps/browser test` and checks, per file:

| Rule | What it counts |
| --- | --- |
| `layout` | an app file outside the folders above |
| `imports` | an import against the direction table, or into a file outside the folders (a component importing `platform/` included, except `components/dev/devHarness.ts`) |
| `native-calls` | a native package, `expo-modules-core` or `NativeModules` used outside `platform/` and `components/ui/` |
| `tokens` | a colour literal, `Easing.` curve or numeric duration outside `tokens.ts`/`motion.ts` |
| `get-state` | `getState(` in `components/` |
| `set-state` | `.setState(` in `components/` |
| `store-reads` | `useBrowser(` in `components/` (read through `state/<domain>/hooks.ts`) |
| `store-shape` | a zustand store not created as `create<T>()(() => init)` (a `set`/`get` creator, or the uncurried form) |
| `size` | a file over its line cap |
| `env` | an environment read outside the launch config and the three exempt engine lines |
| `naming` | a `Cef`, `AC*`/app-side `ArdiaCore*`, `Netnyahoo` or `NN*` name |
| `comments` | a comment that isn't a license header or tool directive |
| `file-names` | a file name breaking the PascalCase/camelCase rule |

`apps/browser/src/conventions-baseline.json` lists the violations that existed when the rules arrived, as
`rule → file → count`. Since 2026-10-26 it is empty: every rule holds everywhere. It stays a ratchet: the test fails on any violation beyond the baseline, and on any baseline entry
higher than what the file has now, so fixes must lower their entries.

- `node apps/browser/src/conventions.test.mjs --report` prints every violation grouped per rule, and the difference
  from the baseline (`--from-head` to scan HEAD instead of the working tree).
- To update the baseline, stage your own hunks, then run
  `node apps/browser/src/conventions.test.mjs --write-baseline` (it scans the git index, so unstaged work stays out;
  check `git diff --cached --stat` lists only your files first, or use `--from-head` to scan HEAD) and commit the baseline with your change. It refuses to write when a rule's
  total grows. The one allowed growth: `imports` may grow while `layout` shrinks, because a file moved out of the old
  layout starts having its imports checked. Moving or renaming a file moves its entries under the new path.
- Never add violations to the baseline by hand. `--force` overrides the refusal and needs the owner's OK.
