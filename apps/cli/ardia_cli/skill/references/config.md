# Config and themes

When the user wants a setting changed for good, or set up from their dotfiles, edit `~/.config/ardia/config.json`
(on Linux `~/.config/ardia/config/config.json`; `ardia config path` prints the folder) with `ardia config` instead
of clicking through Settings. Ardia reads the file at launch and whenever it changes, and never writes it; these
commands don't need Ardia running.

```sh
ardia config init
ardia config list
ardia config set tabLayout top
ardia config set shortcuts.newTab cmd+shift+n
ardia config unset tabLayout
ardia config check
```

`init` creates the folder, `config.json` and the schemas; `list` shows every setting with its allowed values,
default and file value; shortcuts are one per command (`''` unbinds); `unset` leaves Ardia's current value in place;
`check` reports what Ardia would complain about.

Themes are colour overrides in `themes/NAME.json` in that folder. `ardia theme new NAME` writes every dark and light
role with Ardia's values, so change only the ones the user asked about and delete the rest if they like;
`ardia theme use NAME` (or `none`) picks one, and `ardia theme check` checks it. Ask before replacing the user's
own theme or config values. Settings that grant control or send data somewhere (`cliControl`, custom search URLs,
page engines) can't go in the file; tell the user where they are in Settings instead.

To land on a new tab at launch while keeping the session, set `launchActions`:
`ardia config set launchActions '["newTab"]'`.
