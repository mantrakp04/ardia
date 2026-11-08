# Config files

Ardia can be set up from plain files, dotfiles style, and from the `ardia` command (`docs/cli.md`). Closes #716.

## Where

The config folder is `~/.config/ardia/`. An instance started with `ARDIA_DATA_DIR` uses `<data dir>/config` instead,
so test instances never read the owner's files. On macOS no other environment variable picks it (a Finder-launched app
never sees the shell's `XDG_CONFIG_HOME`, so honouring it would make the app and the CLI disagree). The app resolves it
in `ArdiaLaunchConfig`; the CLI resolves it the same way from `--data-dir` / `$ARDIA_DATA_DIR`.

Linux is the exception, because there the folder hangs off Chromium's own user data dir, and Chromium already picks
that from `XDG_CONFIG_HOME` (and the engine from `ARDIA_CONFIG_HOME`). The CLI has to follow the same variables just to
find `ArdiaControl.json`, so honouring them for the config folder adds no new way for the two to disagree.
`~/.config/ardia` is that data dir (`Local State`, `Default/`, `ArdiaControl.json`…), so the config folder is always
`<data dir>/config`: `${XDG_CONFIG_HOME:-~/.config}/ardia/config` by default
(`$ARDIA_CONFIG_HOME/ardia/config` when that's set, as the engine does), `<user data dir>/config` for an instance
started with `--user-data-dir`, and `<data dir>/config` for the CLI's `--data-dir` / `$ARDIA_DATA_DIR`. Keeping it a
folder of its own lets a dotfiles repo own it (one symlink) without Chromium's files landing in the repo, and it is
the same rule a macOS test instance follows. The schemas go to `<data dir>/config-schema/` beside it.

```
~/.config/ardia/            (Linux: ~/.config/ardia/config/)
  config.json          settings and the theme choice
  hooks.json           automation hooks (docs/automation.md)
  themes/<name>.json   colour overrides
  config.schema.json   written by the app
  theme.schema.json    written by the app
```

Ardia never creates the folder. `ardia config init` does, or the user does.

## config.json

```json
{
  "$schema": "./config.schema.json",
  "theme": "nord",
  "settings": {
    "tabLayout": "top",
    "selectedTabGlow": "soft",
    "shortcuts": { "newTab": "cmd+shift+n", "reopenClosedTab": "" }
  }
}
```

- `settings` takes the keys on the config allowlist, a list next to `SETTING_SPECS`
  (`apps/browser/src/state/settings/settings.ts`). A test makes every setting either allowlisted or deliberately
  left out, so a new setting never becomes file-writable by accident. Left out, because they grant control, send
  data somewhere or change which engine handles a site: `cliControl`, `allowJavaScriptFromAppleEvents`,
  `extensionSearchEngines`, `defaultProfileId`, `customSearchUrl`, `customSearchEngines`, `pageEngine`,
  `websiteEngines`, `protectedVideoInWebKit`. `searchEngine` must name an engine that already exists (built in, or
  one the user added in Settings).
- `shortcuts` maps a command id from the command catalog to one shortcut, written `cmd+shift+t` (modifiers
  `cmd`/`command`, `opt`/`option`/`alt`, `ctrl`/`control`, `shift`, `fn`, then one key: a character, `f1`–`f20`,
  `space`, `tab`, `return`, `escape`, `delete`, `up`, `down`, `left`, `right`, `home`, `end`, `pageup`,
  `pagedown`) or in glyphs (`⌘⇧T`, what `formatShortcut` prints). `""` unbinds the command. A command left out keeps
  whatever it has. Fixed commands can't be rebound. The app translates to its stored form (`[key, ...modifiers]`); a
  command's own default shortcut drops its override. Each entry stands alone: a bad one is reported and skipped, the
  others apply.
- `launchActions` is a list of up to 20 Ardia command ids (`"newTab"`, or `"selectTab:2"` for a variant) that the app
  runs itself, once per launch, after the session is restored and the first window is up, in the focused window: no
  CLI control and no LaunchAgent needed. `"launchActions": ["newTab"]` keeps your tabs and lands on a new tab.
  Only commands the ardia command may run (`docs/automation.md`) are accepted; an unknown id or variant makes the
  whole setting invalid, with a message naming it (`config.json: launchActions: fooBar isn't a command`). Actions
  from the safe list (`newTab`, `newWindow`, `newLittleArdia`, `focusCommandBar`, `toggleSidebar`, `nextTab`,
  `previousTab`, `selectTab`, `selectLastTab`) run at once; any other waits for approval in Settings › Advanced ›
  Automation. Re-reading config.json never runs them again. The setting isn't synced: it belongs to this Mac.
- `theme` is a theme name (`^[a-z0-9][a-z0-9_-]*$`, the file `themes/<name>.json`) or `null`. A bad value, or a
  `config.json` that doesn't parse, keeps the theme that is showing.
- Unknown keys inside `settings` are reported and ignored. Other top-level keys are ignored.

### Address bar providers

`settings.omniboxProviders` adds your own rows to the address bar. Each entry is one provider; a bad entry (or a bad
row in it) is reported and skipped, the others apply.

```json
"omniboxProviders": [
  { "keyword": "go", "title": "Linear", "url": "https://linear.app/team/issue/{query}" },
  { "keyword": "t", "title": "Team", "rows": [{ "title": "Wiki", "url": "https://wiki.example.com" }] },
  { "keyword": "pkg", "title": "npm", "suggest": "https://example.com/suggest?q={query}", "url": "https://www.npmjs.com/search?q={query}" },
  { "title": "Docs", "suggest": "https://docs.example.com/suggest?q={query}", "global": true }
]
```

- `keyword` (1–32 characters, no spaces or `/ ? # : @ . !`): typing it, then Space or Tab, enters the provider, shown
  as a chip like a site search. Only its rows show and Enter takes the first one (if none has arrived yet, Enter
  waits for the first). Backspace or Escape leaves it, as in a site search. A provider's keyword wins over a search
  engine's and a site's.
- Without a keyword a provider is **global**: its rows join the normal list in their own section, at most 3 per
  provider and 6 in all, below the first three history, bookmark and tab rows. They are never the inline completion
  or what Enter opens by default, and never push a built-in row out.
- `rows`: a static list of `{ title, url, subtitle?, icon? }` (up to 200), matched against every word you type.
- `url`: a link template; `{query}` is what you typed after the keyword, URL-encoded. Needs a keyword.
- `suggest`: a suggestion endpoint, `https` with `{query}`. It may answer OpenSearch suggestions (`["q", [texts],
  [descriptions], [urls]]`; a text without a URL goes through `url`, else it's dropped) or `[{ "title", "url" }]`.
  Without a keyword it needs `"global": true`, since it then receives everything you type that doesn't look like an
  address.
- `title` names the provider on its chip and on each of its rows (default: the template's host).

**Approval.** A `suggest` endpoint and every global provider stay off until approved in Ardia. The approval is for
the exact definition: editing the entry needs a new one. Static keyword lists and URL templates send nothing and
need none. Pending ones appear in Settings › Advanced › Automation; in code they're `pendingOmniboxProviders()` and
`approveOmniboxProvider(key)` (`apps/browser/src/state/omnibox/`); approvals are kept in the app's data dir with
the other automation approvals and listed in Settings › Advanced › Automation (`docs/automation.md` › Approvals).

**Safety.** Rows only open `http` and `https` URLs (never `javascript:`, `data:`, `file:`, `chrome:` or Ardia's own
pages). Titles are capped at 120 characters and subtitles at 160, with control and bidi characters removed, and each
row shows the destination's host and the provider's title, which Ardia sets. Icons are `https` URLs or
`data:image` (png, jpeg, gif, webp, ico) up to 16 KB. Suggestion requests carry only what you typed: no cookies,
referrer, page, history or profile. They go only to `https` URLs on a plain DNS hostname: no IP
literal of any form (dotted, short, octal, hex or decimal IPv4, IPv6), no percent-encoding, user info or backslash,
a canonical port, and not `localhost` or a private suffix (`.local`, `.internal`, `.lan`, `.home.arpa`, `.test`,
`.onion`…). A DNS name that resolves to a private or loopback address is not blocked: Ardia checks the URL, not
what the name resolves to. They wait 120 ms after the last key, are cancelled by the next key, give up after 1.5 s, keep at most 4
requests in flight, and are cached for 5 minutes per profile. A reply over 128 KB (by its Content-Length, or as soon
as JS sees more than that arrive) is aborted and dropped. That's early cancellation, not a hard memory bound:
React Native's network task appends the bytes it receives before JS hears about them, so a fast endpoint can
deliver more before the abort lands. Only endpoints the user approved are ever fetched. A reply whose final URL
isn't allowed is dropped. Remote, program and extension providers never run in a private window; static lists and
templates do. A test instance (`docs/agent-brief.md` › Launch variables) may also use `http://127.0.0.1` (written
exactly so) endpoints, for fixtures; other builds refuse them.

**Extensions' `chrome.omnibox` keywords** don't reach Ardia's bar yet. The engine lists them (`ac_search_engines.cc`,
`isOmniboxExtension`), but Ardia's location bar has no `OmniboxController`, so nothing calls
`ExtensionOmniboxEventRouter::OnInputStarted/OnInputChanged/OnInputCancelled/OnInputEntered` or listens to
`OmniboxSuggestionsWatcher`. Wiring them needs engine calls (`ac_omnibox_input_*` wrapping those statics, plus an
`extensions.omniboxSuggestions` event from the watcher and the stored default suggestion). Accepting a row would also
hand the input to the extension (`OnInputEntered`) instead of opening a checked URL, which this design avoids, so it
stays off until that's decided.

### The command bar's start

`settings.commandBarStart` sets what a new tab's command bar (⌘T, with New Tab opening the command bar) lists before
you type. It has no Settings row: plugins (github.com/mantrakp04/ardia-plugins) and people write it here.

```json
"commandBarStart": { "openTabs": { "hidePinned": true, "hideTopApps": true, "limit": 5 } }
```

- `openTabs.hidePinned` leaves out pinned tabs (the sidebar's pinned rows), `openTabs.hideTopApps` leaves out Top Apps
  (the tiles). Typing still finds every open tab.
- `openTabs.limit` (0–20, default 8) is how many open tabs it lists; 0 lists none.
- Any other key, or a value of the wrong type, makes the whole setting invalid. `{}` is Ardia's default.
- Code: `state/omnibox/commandBarStart.ts`, used by `useOpenTabsStart` (`components/omnibox/dropdownStart.ts`).
  Telemetry: `settings_snapshot` carries `setting_commandBarStart_hidePinned`, `_hideTopApps` and `_limit` with their
  defaults.

### The file wins

`config.json` is read-only to the app. Ardia never writes it, so there is nothing to race with.

- At launch, and every time `config.json` or the active theme changes on disk, Ardia applies every file setting
  whose value is valid and differs from the current one, through `updateSettings` (so it syncs like a change made in
  Settings).
- A change made in the app, or one that arrives from device sync, stands until the next launch or the next change to
  the file, which puts the file's value back. Sync arrivals don't trigger a re-apply, so two Macs with different
  files can't ping-pong.
- Taking a key out of the file stops the file from setting it; Ardia keeps the current value. To go back to the
  default, set the default value.
- Applying is idempotent: a change event means "read the file again and reconcile", never "something changed once".
  Several Ardia instances can share the folder.

### Files and links

The config folder, `config.json`, `themes/` and theme files may be symlinks (a dotfiles repo); reads follow them.
Ardia reads only regular files (checked after resolving), at most 1 MB, opened non-blocking so a FIFO can't hang the
watcher. The watcher re-resolves the folder when it changes and notices it appearing after launch.

On Linux the reads and the watcher are native (`ac_linux_config_core.cc`, `ac_linux_config.cc`): reads also refuse
text that isn't UTF-8, and the watcher is inotify. It watches the resolved folder, the folder of each watched file and
of its resolved target, `themes/` and its target, and the folder's parent for the folder itself appearing, going or
being re-linked. It resolves links itself, so every link on the way (`config -> ~/dotfiles/current/ardia`,
`current -> release-a`) and a link's missing target are watched too: re-linking `current`, or creating the target of a
dangling theme link, applies at once. Replacing a real directory further up a link's target (renaming
`~/dotfiles/themes`'s parent aside and putting another in its place) isn't noticed until the next change, as on
macOS. Events for other files (the schemas, Chromium's files) are ignored. Changes are coalesced for 50 ms
before every window hears of them, and one watcher serves all windows. The shared code reads synchronously, so each
window keeps the last reads of `config.json` and its themes; it reads `config.json` and the theme it names before the
UI starts, and on a change it reads them again (the newly named theme included) before the shared code reconciles.
Only the launch window applies the file's settings at start, and so restores the session as the file says; a window
opened later takes the theme but leaves settings changed in the app alone, as on macOS, where opening a window isn't
a launch.

### Errors

A file that doesn't parse, an unknown key, a wrong value or a missing theme never breaks anything: Ardia applies what
is valid, skips the rest (a bad value skips that whole setting), logs it and shows one toast per distinct problem
("config.json: selectedTabGlow must be full, soft or off"). An unparseable theme file keeps the last good version of
that theme. `ardia config check` reports the same problems.

## Themes

```json
{
  "$schema": "../theme.schema.json",
  "dark": { "accent": "#88C0D0", "panel": "#2E3440", "textPrimary": "#ECEFF4" },
  "light": { "accent": "#5E81AC" }
}
```

- `dark` and `light` take any colour role of `colorRoles` (`apps/browser/src/components/ui/tokens.ts`) except
  `dark` itself. Colours are `#RGB`, `#RRGGBB`, `#RRGGBBAA`, `rgb(r,g,b)` or `rgba(r,g,b,a)` (r, g, b integers 0–255,
  a 0–1). Number roles are finite: `grain` and the `…Opacity` roles 0–1, the `…Radius` roles 0–100.
  `tabSelectedBorder` takes two colours. A role left out, or a bad one, uses Ardia's value. Keys other than `$schema`,
  `dark` and `light`, and names that aren't roles, are reported (the schema has `additionalProperties: false`).
- The file's roles replace Ardia's in the base palettes, before anything else. Profile colours and custom profile
  themes keep adding what they add today (backdrop, tint, accent); incognito uses the dark palette, with the file's
  dark roles, plus its tint.
- `theme: null`, no `theme` key, a missing theme file or no `config.json` means Ardia's own palette.
- Picking a theme, or editing the active theme's file, restyles every window at once, no restart. The effective base
  palette carries a revision, and every cache and snapshot built from roles depends on it.

## Schemas

The app writes `config.schema.json` and `theme.schema.json` (JSON Schema 2020-12) to `<data dir>/config-schema/` at
every launch, and into the config folder whenever it exists, rewriting only when the content changed (temp file and
rename, replacing a symlinked schema rather than writing through it). They are generated from the allowlisted
`SETTING_SPECS` entries (each spec carries its schema; a test checks schema and validator agree on samples and
defaults), the command catalog (the property names of `shortcuts`) and `colorRoles` (each role's `default` is
Ardia's dark or light value), so they never drift. They help editors and the CLI; the app always validates with its
own code.

They use only this subset, which `ardia` checks itself without a JSON Schema library (other keywords are ignored):
`type` (one or a list), `enum`, `const`, `default`, `description`, `minimum`, `maximum`, `exclusiveMinimum`,
`pattern`, `items`, `prefixItems`, `minItems`, `maxItems`, `properties`, `additionalProperties` (boolean or schema),
`propertyNames`, `required`, `anyOf`.

## The ardia command

None of these need Ardia running; they read and write the files, and a running Ardia picks the change up at once.
Keys, values and defaults come from the schemas in the config folder, else `<data dir>/config-schema/` (the
`--data-dir` / `$ARDIA_DATA_DIR` one, else the installed app's). With neither, `set` writes without checking and says
so. Exit codes: 0 done, 1 a check failed or the input is wrong.

- `ardia config path` prints the config folder.
- `ardia config init` creates the folder, a `config.json` (`$schema`, `theme: null`, `settings: {}`) and the schemas
  it can find. It never overwrites a file.
- `ardia config get [KEY] [--json]` prints one setting from the file (exit 1 if the file doesn't set it), or the whole
  file. KEY is a setting name, or `shortcuts.<command id>`.
- `ardia config set KEY VALUE` parses VALUE as JSON, else takes it as a string (also when the JSON value fails the
  check and the string passes), checks it, and writes it, creating `config.json` first if needed. It rewrites
  the file even when the value is already there, so a running Ardia re-applies it. An unknown
  key names the closest ones; a wrong value names what's allowed. The left-out settings are refused with or
  without a schema, and `cmd+shift+t` shortcuts are parsed (modifier and key names) so typos fail; glyph
  shortcuts pass if the schema allows them.
- `ardia config unset KEY` removes it from the file. Ardia keeps the current value. A key the file doesn't set
  is a no-op (exit 0); a name that isn't a setting is an error.
- `ardia config list [--json]` lists every key with its type or allowed values, default and file value.
- `ardia config edit` opens `config.json` (created first if needed) in `$VISUAL`, `$EDITOR` (split like a shell
  word list), else `vi` (as git does), waits for the editor to exit, then runs `check`.
- `ardia config check [--json]` checks `config.json` and the theme it names. Theme problems use the app's wording;
  the theme schema supplies the role names and each role's kind (from its `default`). `--json` prints
  `{"ok", "files": [{"file", "problems": [{"key", "message"}]}], "warnings"}`.
- `ardia theme new NAME [--from THEME]` writes `themes/NAME.json` with every role, from Ardia's defaults or from
  another theme. It never overwrites.
- `ardia theme use NAME|none` sets `theme` in `config.json`, creating it first if needed.
- `ardia theme list [--json]` lists the themes and marks the active one.
- `ardia theme check [NAME|FILE] [--json]` checks a theme (default: the active one).

`set`, `unset` and `theme use` refuse to touch a `config.json` that doesn't parse or whose root or `settings` isn't an
object. Writes keep the file's key order and other keys, use 2-space indents and a final newline, and go through an
exclusive temp file and a rename. A symlinked `config.json` is written through: the resolved target is replaced, in
its own folder, so the link survives. `theme new` refuses a name that exists, a dangling link included.
