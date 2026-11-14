# Config files

Ardia can be set up from plain files, dotfiles style, and from the `ardia` command (`docs/cli.md`). Closes #716.

## Where

The config folder is `~/.config/ardia/`. An instance started with `ARDIA_DATA_DIR` uses `<data dir>/config` instead,
so test instances never read the owner's files. No other environment variable picks it (a Finder-launched app never
sees the shell's `XDG_CONFIG_HOME`, so honouring it would make the app and the CLI disagree). The app resolves it in
`ArdiaLaunchConfig`; the CLI resolves it the same way from `--data-dir` / `$ARDIA_DATA_DIR`.

```
~/.config/ardia/
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

### Errors

A file that doesn't parse, an unknown key, a wrong value or a missing theme never breaks anything: Ardia applies what
is valid, skips the rest (a bad value skips that whole setting), logs it and shows one toast per distinct problem
("config.json: selectedTabGlow must be full, soft or off"). An unparseable theme file keeps the last good version of
that theme. `ardia config check` reports the same problems.

## Themes

A theme is `<config folder>/themes/NAME.json`; `config.json`'s `theme` picks one. It holds colour roles per
appearance and four look blocks. Every key is optional, and a block left out is Ardia's own look.

```json
{
  "$schema": "../theme.schema.json",
  "dark": { "accent": "#88C0D0", "panel": "#2E3440", "textPrimary": "#ECEFF4" },
  "light": { "accent": "#5E81AC" },
  "type": { "family": "Avenir Next", "scale": 1.05, "sizes": { "small": 13 }, "weights": { "medium": "600" } },
  "metrics": { "rowHeight": 30, "rowGap": 2, "sidebarWidth": 240, "radius": { "row": 6, "panel": 10 } },
  "layout": { "hide": ["navButtons", "profile"], "addressField": "bottom", "newTab": "top" },
  "icons": { "plus": "plus.circle", "sidebar.left": "rectangle.lefthalf.inset.filled" }
}
```

### Colours

- `dark` and `light` take any colour role of `colorRoles` (`apps/browser/src/components/ui/tokens.ts`). Colours are
  `#RGB`, `#RRGGBB`, `#RRGGBBAA`, `rgb(r,g,b)` or `rgba(r,g,b,a)` (r, g, b integers 0–255, a 0–1). Number roles are
  finite: `grain` and the `…Opacity` roles 0–1, the `…Radius` roles 0–100. `tabSelectedBorder` takes two colours.
- The file's roles replace Ardia's in the base palettes, before anything else. Profile colours and custom profile
  themes keep adding what they add today (backdrop, tint, accent); incognito uses the dark palette, with the file's
  dark roles, plus its tint.

### type

Fonts and text sizes in the interface. Web pages keep their own fonts.

| Key | Values | Default | Affects |
| --- | --- | --- | --- |
| `family` | a font family name, 1–64 characters, no space at either end | the system font | every interface font: the Text component, every style of the type scale, the sidebar's tab and row titles, fields. A family macOS doesn't have falls back to the system font |
| `mono` | a font family name | `"Menlo"` | codes, keys, logs and other monospaced text |
| `scale` | 0.85–1.3 | 1 | multiplies every text size, after `sizes` |
| `sizes.badge` | 7–14 | 9 | counts on badges |
| `sizes.tiny` | 8–16 | 10 | the smallest labels |
| `sizes.caption` | 8–18 | 11 | captions, section labels, URLs under titles |
| `sizes.small` | 9–19 | 12 | sidebar tab titles, secondary text |
| `sizes.body` | 10–21 | 13 | most text: menus, fields, folder and group names |
| `sizes.title` | 11–24 | 15 | panel and dialog titles, the command bar's results |
| `sizes.large` | 13–27 | 17 | large headings, the command bar's field |
| `weights.regular`, `.medium`, `.semibold`, `.bold` | `"100"`–`"900"` in steps of 100, string or number | `"400"`, `"500"`, `"600"`, `"700"` | what each weight name draws with |

The seven sizes are Ardia's text sizes everywhere in the chrome; line heights scale with them.

### metrics

Sizes and corner radii, in points.

| Key | Values | Default | Affects |
| --- | --- | --- | --- |
| `rowHeight` | 24–56 | 34 | every sidebar row: tabs, folders, groups, live folders, New Tab, the sidebar address field. Drag targeting, list motion and scrolling to a tab follow it |
| `rowGap` | 0–12 | 3 | the space between sidebar rows, with the same followers |
| `pinnedHeight` | 28–72 | 41 | pinned tiles in the sidebar's top apps grid, and the grid's drop slots |
| `sidebarWidth` | 160–400 | none: the width is yours | the sidebar takes this width when you switch to the theme or change the value, and a double-click on the sidebar edge returns to it |
| `radius.row` | 0–24 | 10 | sidebar rows, the sidebar address field, top-strip tabs |
| `radius.pinned` | 0–24 | 10 | pinned tiles |
| `radius.tile` | 0–24 | 8 | list and menu rows, fields, cards, icon tiles |
| `radius.control` | 0–12 | 4 | small controls: steppers, chips, keys |
| `radius.toolbar` | 0–24 | 7 | toolbar button plates |
| `radius.panel` | 0–28 | 12 | popovers, menus and panels |
| `radius.sheet` | 0–32 | 16 | sheets, the tab switcher, search and other large panels |

### layout

| Key | Values | Default | Affects |
| --- | --- | --- | --- |
| `hide` | a list of parts (below) | `[]` | hides those parts of the sidebar |
| `addressField` | `"top"` or `"bottom"` | `"top"` | where the sidebar address field sits, when the address bar is in the sidebar. At the bottom (or hidden), ⌘L and a click on the field open the command bar centred |
| `newTab` | `"top"` or `"bottom"` | none: Settings › Tabs decides | the New Tab row at the top or bottom of the tab list; set, it wins over Settings › Tabs while the theme is active |

The parts `hide` takes, all in the sidebar: `pinned` (the top apps grid, with its drop slots: tabs can't be dragged
into a hidden grid), `newTab` (the New Tab row, inline or docked), `addressField` (the sidebar address field, when the
address bar is in the sidebar), `navButtons` and `sidebarButton` (back, forward, reload and the Hide Tabs button in the
sidebar header, when the address bar is in the sidebar; the toolbar's own buttons stay), `downloads` (the sidebar's
downloads button) and `profile` (the profile name in the sidebar header and the profile dots at the bottom).

### icons

An object from an SF Symbol name to the one to draw instead, both lowercase letters, digits and dots
(`"sidebar.left": "rectangle.lefthalf.inset.filled"`). Default `{}`. It replaces the symbol everywhere in the chrome
and in Ardia's context menus. A name macOS doesn't have draws nothing.

### How a theme applies

- Each bad key or value is reported on its own, in the app's words (`metrics.rowHeight must be a number from 24 to
  56`, `layout.hide has "toolbar", which isn't a part (pinned, newTab, …)`), and the valid rest still applies. A bad
  key falls back to Ardia's value for that key only. Keys other than `$schema`, `dark`, `light`, `type`, `metrics`,
  `layout` and `icons`, and names that aren't roles or look keys, are reported (the schema has
  `additionalProperties: false`).
- A file that doesn't parse keeps the last good version of that theme.
- `theme: null`, no `theme` key, a missing theme file or no `config.json` means Ardia's own palette and look.
- Saving the active theme's file, or switching themes, restyles every window at once: no restart, and no page
  reloads. The effective base palette carries a revision, and every cache and snapshot built from roles or the look
  depends on it.

## Schemas

The app writes `config.schema.json` and `theme.schema.json` (JSON Schema 2020-12) to `<data dir>/config-schema/` at
every launch, and into the config folder whenever it exists, rewriting only when the content changed (temp file and
rename, replacing a symlinked schema rather than writing through it). They are generated from the allowlisted
`SETTING_SPECS` entries (each spec carries its schema; a test checks schema and validator agree on samples and
defaults), the command catalog (the property names of `shortcuts`), `colorRoles` (each role's `default` is
Ardia's dark or light value) and the look spec in `apps/browser/src/lib/themeLook.ts` (ranges, parts and defaults
of `type`, `metrics`, `layout` and `icons`), so they never drift. They help editors and the CLI; the app always validates with its
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
  the theme schema supplies the role names, each role's kind (from its `default`), the look blocks' keys, ranges,
  parts and defaults. Without a schema, roles are checked by the kind of value given and the look blocks against
  the ranges built into `ardia`. `--json` prints
  `{"ok", "files": [{"file", "problems": [{"key", "message"}]}], "warnings"}`.
- `ardia theme new NAME [--from THEME]` writes `themes/NAME.json` with every role and every look key that has a
  default (so no `type.family`, `metrics.sidebarWidth` or `layout.newTab`), from Ardia's defaults or from another
  theme, whose values win key by key. The file passes `ardia theme check`. It never overwrites.
- `ardia theme use NAME|none` sets `theme` in `config.json`, creating it first if needed.
- `ardia theme list [--json]` lists the themes and marks the active one.
- `ardia theme check [NAME|FILE] [--json]` checks a theme (default: the active one).

`set`, `unset` and `theme use` refuse to touch a `config.json` that doesn't parse or whose root or `settings` isn't an
object. Writes keep the file's key order and other keys, use 2-space indents and a final newline, and go through an
exclusive temp file and a rename. A symlinked `config.json` is written through: the resolved target is replaced, in
its own folder, so the link survives. `theme new` refuses a name that exists, a dangling link included.
