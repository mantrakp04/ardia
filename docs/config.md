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
- `theme` is a theme name (`^[a-z0-9][a-z0-9_-]*$`, the file `themes/<name>.json`) or `null`. A bad value, or a
  `config.json` that doesn't parse, keeps the theme that is showing.
- Unknown keys inside `settings` are reported and ignored. Other top-level keys are ignored.

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
