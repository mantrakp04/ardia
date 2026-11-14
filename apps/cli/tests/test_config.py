import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli import cli, config_cli, config_files, endpoint
from ardia_cli.schema_check import validate

FIXTURES = Path(__file__).resolve().parent / "fixtures"
CONFIG_SCHEMA = json.loads((FIXTURES / "config.schema.json").read_text())
THEME_SCHEMA = json.loads((FIXTURES / "theme.schema.json").read_text())
PARTS = "pinned, newTab, addressField, navButtons, sidebarButton, downloads, profile"
SYMBOL = "an SF Symbol name (lowercase letters, digits and dots)"
FAMILY = "must be a font family name (1 to 64 characters, no space at either end)"
LOOK_DEFAULTS = {
    "type": {
        "mono": "Menlo",
        "scale": 1,
        "sizes": {"badge": 9, "tiny": 10, "caption": 11, "small": 12, "body": 13, "title": 15, "large": 17},
        "weights": {"regular": "400", "medium": "500", "semibold": "600", "bold": "700"},
    },
    "metrics": {
        "rowHeight": 34,
        "rowGap": 3,
        "pinnedHeight": 41,
        "radius": {"row": 10, "pinned": 10, "tile": 8, "control": 4, "toolbar": 7, "panel": 12, "sheet": 16},
    },
    "layout": {"hide": [], "addressField": "top"},
    "icons": {},
}
BAD_LOOK = {
    "type": {"family": "", "mono": " Menlo", "scale": 3, "sizes": {"body": 40, "huge": 30, "small": 12}, "weights": {"medium": "550", "bold": "700"}, "color": 1},
    "metrics": {"rowHeight": 10, "rowGap": "3", "pinnedHeight": 60, "radius": {"row": 99, "card": 4, "tile": 6}},
    "layout": {"hide": ["pinned", "toolbar", 3], "addressField": "left", "newTab": "bottom"},
    "icons": {"plus": "", "Bad Name": "x", "minus": "minus.circle"},
}
BAD_LOOK_PROBLEMS = [
    f"type.family {FAMILY}",
    f"type.mono {FAMILY}",
    "type.scale must be a number from 0.85 to 1.3",
    "type.sizes.body must be a number from 10 to 21",
    "type.sizes.huge isn't a text size key (badge, tiny, caption, small, body, title, large)",
    'type.weights.medium must be a weight from "100" to "900" in steps of 100',
    "type.color isn't a type key (family, mono, scale, sizes, weights)",
    "metrics.rowHeight must be a number from 24 to 56",
    "metrics.rowGap must be a number from 0 to 12",
    "metrics.radius.row must be a number from 0 to 24",
    "metrics.radius.card isn't a radius key (row, pinned, tile, control, toolbar, panel, sheet)",
    f'layout.hide has "toolbar", which isn\'t a part ({PARTS})',
    f"layout.hide has 3, which isn't a part ({PARTS})",
    "layout.addressField must be one of top, bottom",
    f"icons.plus must be {SYMBOL}",
    f'icons has "Bad Name", which isn\'t {SYMBOL}',
]


def without_descriptions(node):
    if isinstance(node, dict):
        return {k: without_descriptions(v) for k, v in node.items() if k != "description"}
    if isinstance(node, list):
        return [without_descriptions(v) for v in node]
    return node


class Sandbox(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp(prefix="ardia-config-test-")).resolve()
        self.home = self.temp / "home"
        self.data = self.temp / "data"
        self.installed = self.temp / "installed"
        for folder in (self.home, self.data, self.installed):
            folder.mkdir()
        patches = [
            mock.patch.dict(os.environ, {"HOME": str(self.home), "ARDIA_DATA_DIR": str(self.data)}),
            mock.patch.object(endpoint, "INSTALLED_DATA_DIR", self.installed),
        ]
        for name in ("VISUAL", "EDITOR"):
            patches.append(mock.patch.dict(os.environ, {name: ""}))
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(shutil.rmtree, self.temp, True)
        self.folder = self.data / "config"

    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                status = cli.main(list(argv))
            except SystemExit as exit:
                status = exit.code
        return status, out.getvalue(), err.getvalue()

    def ok(self, *argv):
        status, out, err = self.run_cli(*argv)
        self.assertEqual(status, 0, f"{argv}: {out}{err}")
        return out, err

    def fails(self, *argv):
        status, out, err = self.run_cli(*argv)
        self.assertEqual(status, 1, f"{argv}: {out}{err}")
        return out, err

    def install_schemas(self, folder=None):
        target = folder or self.data / "config-schema"
        target.mkdir(parents=True, exist_ok=True)
        shutil.copy(FIXTURES / "config.schema.json", target / "config.schema.json")
        shutil.copy(FIXTURES / "theme.schema.json", target / "theme.schema.json")

    def config(self):
        return json.loads((self.folder / "config.json").read_text())

    def write_config(self, document):
        self.folder.mkdir(parents=True, exist_ok=True)
        (self.folder / "config.json").write_text(json.dumps(document, indent=2) + "\n")


class Paths(Sandbox):
    def test_data_dir_env_picks_config_folder(self):
        out, _ = self.ok("config", "path")
        self.assertEqual(out.strip(), str(self.folder))

    def test_data_dir_flag_wins_over_env(self):
        other = self.temp / "other"
        out, _ = self.ok("config", "path", "--data-dir", str(other))
        self.assertEqual(out.strip(), str(other / "config"))

    def test_default_is_home_config(self):
        with mock.patch.dict(os.environ, {"ARDIA_DATA_DIR": ""}):
            out, _ = self.ok("config", "path")
        self.assertEqual(out.strip(), str(self.home / ".config" / "ardia"))

    def test_xdg_config_home_is_ignored(self):
        with mock.patch.dict(os.environ, {"ARDIA_DATA_DIR": "", "XDG_CONFIG_HOME": str(self.temp / "xdg")}):
            out, _ = self.ok("config", "path")
        self.assertEqual(out.strip(), str(self.home / ".config" / "ardia"))

    def test_schema_from_installed_app_without_data_dir(self):
        self.install_schemas(self.installed / "config-schema")
        with mock.patch.dict(os.environ, {"ARDIA_DATA_DIR": ""}):
            where = config_files.places()
            self.assertEqual(config_files.find_schema(where, "config.schema.json").path, self.installed / "config-schema" / "config.schema.json")

    def test_config_folder_schema_wins(self):
        self.install_schemas()
        self.install_schemas(self.folder)
        where = config_files.places()
        self.assertEqual(config_files.find_schema(where, "config.schema.json").path, self.folder / "config.schema.json")


class Init(Sandbox):
    def test_init_creates_and_is_idempotent(self):
        self.install_schemas()
        out, _ = self.ok("config", "init")
        self.assertIn("created", out)
        self.assertEqual(self.config(), {"$schema": "./config.schema.json", "theme": None, "settings": {}})
        self.assertTrue((self.folder / "config.schema.json").is_file())
        self.assertTrue((self.folder / "theme.schema.json").is_file())
        self.assertTrue((self.folder / "themes").is_dir())
        (self.folder / "config.json").write_text('{"settings": {"tabLayout": "top"}}\n')
        out, _ = self.ok("config", "init")
        self.assertNotIn("created", out)
        self.assertEqual((self.folder / "config.json").read_text(), '{"settings": {"tabLayout": "top"}}\n')

    def test_init_without_schema_says_so(self):
        _, err = self.ok("config", "init")
        self.assertIn("no config.schema.json", err)
        self.assertTrue((self.folder / "config.json").is_file())

    def test_init_keeps_dangling_link(self):
        self.folder.mkdir(parents=True)
        os.symlink(self.temp / "nowhere.json", self.folder / "config.json")
        self.ok("config", "init")
        self.assertTrue((self.folder / "config.json").is_symlink())
        self.assertFalse((self.temp / "nowhere.json").exists())


class SetGetUnset(Sandbox):
    def setUp(self):
        super().setUp()
        self.install_schemas()

    def test_round_trip_keeps_order_and_unknown_keys(self):
        self.write_config({"$schema": "./config.schema.json", "custom": {"x": 1}, "theme": None, "settings": {"selectedTabGlow": "soft", "futureThing": 3}})
        self.ok("config", "set", "tabLayout", "top")
        self.ok("config", "set", "selectedTabGlow", "off")
        document = self.config()
        self.assertEqual(list(document), ["$schema", "custom", "theme", "settings"])
        self.assertEqual(list(document["settings"].items()), [("selectedTabGlow", "off"), ("futureThing", 3), ("tabLayout", "top")])
        text = (self.folder / "config.json").read_text()
        self.assertTrue(text.endswith("}\n"))
        self.assertIn('\n  "settings": {\n    "selectedTabGlow"', text)
        out, _ = self.ok("config", "get", "tabLayout")
        self.assertEqual(out, "top\n")
        out, _ = self.ok("config", "get", "tabLayout", "--json")
        self.assertEqual(out, '"top"\n')
        self.ok("config", "unset", "tabLayout")
        self.assertNotIn("tabLayout", self.config()["settings"])
        self.assertEqual(self.config()["custom"], {"x": 1})
        out, _ = self.fails("config", "get", "tabLayout")
        self.assertEqual(out, "")

    def test_set_rewrites_even_when_unchanged(self):
        self.write_config({"settings": {"tabLayout": "top"}})
        path = self.folder / "config.json"
        before = path.stat().st_ino
        self.ok("config", "set", "tabLayout", "top")
        self.assertNotEqual(path.stat().st_ino, before)

    def test_set_creates_config(self):
        self.ok("config", "set", "warnBeforeQuitting", "true")
        self.assertEqual(self.config(), {"$schema": "./config.schema.json", "theme": None, "settings": {"warnBeforeQuitting": True}})

    def test_values_parse_as_json_else_string(self):
        self.ok("config", "set", "glassTintAmount", "0.5")
        self.ok("config", "set", "searchEngine", "123")
        self.ok("config", "set", "mutedSites", '["a.com", "b.com"]')
        self.ok("config", "set", "cleanUpInactiveTabsAfterMinutes", "null")
        settings = self.config()["settings"]
        self.assertEqual(settings["glassTintAmount"], 0.5)
        self.assertEqual(settings["searchEngine"], "123")
        self.assertEqual(settings["mutedSites"], ["a.com", "b.com"])
        self.assertIsNone(settings["cleanUpInactiveTabsAfterMinutes"])

    def test_shortcuts_dotted(self):
        self.write_config({"settings": {"shortcuts": {"newWindow": "cmd+n"}}})
        self.ok("config", "set", "shortcuts.newTab", "cmd+shift+t")
        self.ok("config", "set", "shortcuts.reopenClosedTab", "")
        self.ok("config", "set", "shortcuts.toggleSidebar", "⌘⇧S")
        self.assertEqual(self.config()["settings"]["shortcuts"], {"newWindow": "cmd+n", "newTab": "cmd+shift+t", "reopenClosedTab": "", "toggleSidebar": "⌘⇧S"})
        out, _ = self.ok("config", "get", "shortcuts.newTab")
        self.assertEqual(out, "cmd+shift+t\n")
        self.ok("config", "unset", "shortcuts.newTab")
        self.assertEqual(list(self.config()["settings"]["shortcuts"]), ["newWindow", "reopenClosedTab", "toggleSidebar"])
        self.fails("config", "get", "shortcuts.newTab")
        _, err = self.fails("config", "set", "shortcuts.newTabb", "cmd+t")
        self.assertIn("did you mean newTab", err)
        _, err = self.fails("config", "set", "shortcuts.newTab", "cmd+shit+t")
        self.assertIn("unknown modifier shit (did you mean shift?)", err)
        _, err = self.fails("config", "set", "shortcuts.newTab", "cmd+shift+")
        self.assertIn("ends without a key", err)
        _, err = self.fails("config", "set", "shortcuts.newTab", "cmd+pgup")
        self.assertIn("unknown key pgup", err)
        self.ok("config", "set", "shortcuts.newTab", "ctrl+opt+f12")
        self.ok("config", "set", "shortcuts.newTab", "cmd++")

    def test_unknown_key_suggests(self):
        _, err = self.fails("config", "set", "tabLayot", "top")
        self.assertIn("unknown setting tabLayot (did you mean tabLayout?)", err)
        _, err = self.fails("config", "unset", "tabLayot")
        self.assertIn("did you mean tabLayout", err)

    def test_wrong_value_names_allowed(self):
        _, err = self.fails("config", "set", "selectedTabGlow", "glowy")
        self.assertIn("selectedTabGlow must be full, soft or off", err)
        self.assertFalse((self.folder / "config.json").exists())

    def test_reserved_refused_with_and_without_schema(self):
        for key in config_files.RESERVED_SETTINGS:
            _, err = self.fails("config", "set", key, "true")
            self.assertIn(f"{key} can't be set from config.json", err)
        shutil.rmtree(self.data / "config-schema")
        _, err = self.fails("config", "set", "pageEngine", "webkit")
        self.assertIn("pageEngine can't be set from config.json", err)

    def test_refuses_broken_files(self):
        self.folder.mkdir(parents=True)
        path = self.folder / "config.json"
        for text in ('{"settings": {', "[]", '{"settings": []}', '{"settings": null}'):
            path.write_text(text)
            for argv in (("config", "set", "tabLayout", "top"), ("config", "unset", "tabLayout"), ("theme", "use", "none")):
                self.fails(*argv)
            self.assertEqual(path.read_text(), text)

    def test_symlinked_config_written_through(self):
        dotfiles = self.temp / "dotfiles"
        dotfiles.mkdir()
        real = dotfiles / "ardia.json"
        real.write_text('{"settings": {}}\n')
        self.folder.mkdir(parents=True)
        os.symlink(real, self.folder / "config.json")
        self.ok("config", "set", "tabLayout", "top")
        self.assertTrue((self.folder / "config.json").is_symlink())
        self.assertEqual(json.loads(real.read_text())["settings"], {"tabLayout": "top"})
        self.assertEqual([p.name for p in dotfiles.iterdir()], ["ardia.json"])
        self.assertEqual([p.name for p in self.folder.iterdir()], ["config.json"])

    def test_huge_numbers_are_strings_or_refused(self):
        _, err = self.fails("config", "set", "glassTintAmount", "1e400")
        self.assertIn("glassTintAmount must be", err)
        self.ok("config", "set", "searchEngine", "1e400")
        self.assertEqual(self.config()["settings"]["searchEngine"], "1e400")

    def test_dangling_config_link_refused(self):
        self.folder.mkdir(parents=True)
        os.symlink(self.temp / "gone.json", self.folder / "config.json")
        _, err = self.fails("config", "set", "tabLayout", "top")
        self.assertIn("doesn't exist", err)
        self.assertFalse((self.temp / "gone.json").exists())

    def test_keeps_file_mode(self):
        self.write_config({"settings": {}})
        os.chmod(self.folder / "config.json", 0o640)
        self.ok("config", "set", "tabLayout", "top")
        self.assertEqual((self.folder / "config.json").stat().st_mode & 0o777, 0o640)

    def test_get_whole_file(self):
        self.write_config({"theme": None, "settings": {"tabLayout": "top"}})
        out, _ = self.ok("config", "get")
        self.assertEqual(json.loads(out), {"theme": None, "settings": {"tabLayout": "top"}})
        out, _ = self.ok("config", "get", "--json")
        self.assertEqual(json.loads(out)["settings"], {"tabLayout": "top"})

    def test_list(self):
        self.write_config({"settings": {"tabLayout": "top", "mystery": 1}})
        out, _ = self.ok("config", "list")
        line = next(l for l in out.splitlines() if l.startswith("tabLayout"))
        self.assertIn("sidebar or top", line)
        self.assertTrue(line.rstrip().endswith("top"))
        self.assertIn("mystery", out)
        out, _ = self.ok("config", "list", "--json")
        rows = {r["key"]: r for r in json.loads(out)["settings"]}
        self.assertEqual(rows["tabLayout"], {"key": "tabLayout", "allowed": "sidebar or top", "default": "sidebar", "description": "Where tabs go.", "value": "top"})
        self.assertNotIn("value", rows["selectedTabGlow"])

    def test_no_temp_files_left(self):
        self.write_config({"settings": {}})
        self.ok("config", "set", "tabLayout", "top")
        self.fails("config", "set", "tabLayout", "nope")
        self.assertEqual(sorted(p.name for p in self.folder.iterdir()), ["config.json"])


class MissingSchema(Sandbox):
    def test_set_writes_unchecked_and_says_so(self):
        _, err = self.ok("config", "set", "selectedTabGlow", "anything")
        self.assertIn("without checking", err)
        self.assertEqual(self.config()["settings"]["selectedTabGlow"], "anything")

    def test_check_warns_and_checks_syntax(self):
        self.write_config({"theme": "Bad Name", "settings": {"shortcuts": {"newTab": "cmd+shit+t"}, "cliControl": True}})
        out, err = self.fails("config", "check")
        self.assertIn("no config.schema.json", err)
        self.assertIn("theme must be null or a theme name", out)
        self.assertIn("unknown modifier shit", out)
        self.assertIn("cliControl can't be set", out)

    def test_theme_new_needs_schema_or_from(self):
        _, err = self.fails("theme", "new", "nord")
        self.assertIn("no theme.schema.json", err)

    def test_theme_new_from_and_check_without_schema(self):
        themes = self.folder / "themes"
        themes.mkdir(parents=True)
        (themes / "base.json").write_text(json.dumps({"dark": {"accent": "#88C0D0"}, "layout": {"hide": ["pinned"]}}))
        self.ok("theme", "new", "copy", "--from", "base")
        document = json.loads((themes / "copy.json").read_text())
        self.assertEqual(document["layout"], {"hide": ["pinned"], "addressField": "top"})
        self.assertEqual(document["metrics"], LOOK_DEFAULTS["metrics"])
        out, err = self.ok("theme", "check", "copy")
        self.assertIn("themes/copy.json: ok", out)
        self.assertIn("no theme.schema.json", err)
        (themes / "bad.json").write_text(json.dumps(BAD_LOOK))
        out, _ = self.fails("theme", "check", "bad")
        self.assertEqual(out.splitlines(), [f"themes/bad.json: {m}" for m in BAD_LOOK_PROBLEMS])

    def test_list_without_schema(self):
        self.write_config({"settings": {"tabLayout": "top"}})
        out, err = self.ok("config", "list")
        self.assertIn("tabLayout", out)
        self.assertIn("no config.schema.json", err)


class Validation(unittest.TestCase):
    def messages(self, settings):
        return [p.message for p in config_cli.config_problems({"settings": settings}, CONFIG_SCHEMA)]

    def test_fixture_defaults_are_valid(self):
        defaults = {k: v["default"] for k, v in config_files.setting_specs(CONFIG_SCHEMA).items()}
        self.assertEqual(self.messages(defaults), [])
        for mode in config_files.MODES:
            roles = config_cli.theme_defaults(THEME_SCHEMA, mode)
            self.assertEqual(config_cli.theme_problems({mode: roles}, THEME_SCHEMA), [])

    def test_every_keyword(self):
        cases = [
            ({"tabLayout": "left"}, "tabLayout must be sidebar or top"),
            ({"selectedTabGlow": "glowy"}, "selectedTabGlow must be full, soft or off"),
            ({"warnBeforeQuitting": "yes"}, "warnBeforeQuitting must be true or false"),
            ({"warnBeforeQuitting": 1}, "warnBeforeQuitting must be true or false"),
            ({"glassTintAmount": 2}, "glassTintAmount must be at most 1"),
            ({"glassTintAmount": -0.1}, "glassTintAmount must be at least 0"),
            ({"glassTintAmount": True}, "glassTintAmount must be a number at least 0 and at most 1"),
            ({"sidebarWidth": 0}, "sidebarWidth must be more than 0"),
            ({"schemaVersion": 2}, "schemaVersion must be 1"),
            ({"schemaVersion": True}, "schemaVersion must be 1"),
            ({"cleanUpInactiveTabsAfterMinutes": "soon"}, "cleanUpInactiveTabsAfterMinutes must be a number more than 0 or null"),
            ({"cleanUpInactiveTabsAfterMinutes": -5}, "cleanUpInactiveTabsAfterMinutes must be more than 0"),
            ({"mutedSites": ["a.com", 3]}, "mutedSites[1] must be a string"),
            ({"mutedSites": "a.com"}, "mutedSites must be a list of strings"),
            ({"keepActiveSites": ["a", "b", "c", "d"]}, "keepActiveSites must have at most 3 items"),
            ({"littleArdiaSize": [900]}, "littleArdiaSize must have at least 2 items"),
            ({"littleArdiaSize": [900, 0]}, "littleArdiaSize[1] must be more than 0"),
            ({"littleArdiaSize": [900, 640, 1]}, "littleArdiaSize must have at most 2 items"),
            ({"neverTranslateSites": {"fr": "x.com"}}, "neverTranslateSites.fr must be a list of strings"),
            ({"sitePermissions": {}}, "sitePermissions needs camera"),
            ({"sitePermissions": {"camera": "on"}}, "sitePermissions.camera must be true or false"),
            ({"shortcuts": {"newTabb": "cmd+t"}}, "unknown key newTabb in shortcuts (did you mean newTab?)"),
            ({"shortcuts": {"newTab": ["⌘T"]}}, "shortcuts.newTab must be a string"),
            ({"tabLayuot": "top"}, "unknown setting tabLayuot (did you mean tabLayout?)"),
        ]
        for settings, message in cases:
            with self.subTest(settings=settings):
                self.assertEqual(self.messages(settings), [message])

    def test_theme_pattern_and_type(self):
        problems = config_cli.config_problems({"theme": "../evil", "settings": {}}, CONFIG_SCHEMA)
        self.assertEqual([p.message for p in problems], ["theme must match ^[a-z0-9][a-z0-9_-]*$"])
        problems = config_cli.config_problems({"theme": 3, "settings": {}}, CONFIG_SCHEMA)
        self.assertEqual([p.message for p in problems], ["theme must be a string or null"])

    def test_pattern_dollar_is_end_of_string(self):
        self.assertTrue(validate("nord\n", {"pattern": "^[a-z]+$"}))
        self.assertFalse(validate("nord", {"pattern": "^[a-z]+$"}))
        self.assertFalse(validate("a$", {"pattern": "^a[$]$"}))

    def test_integer_type_and_additional_schema(self):
        self.assertFalse(validate(2.0, {"type": "integer"}))
        self.assertTrue(validate(2.5, {"type": "integer"}))
        self.assertTrue(validate({"a": 1}, {"additionalProperties": {"type": "string"}}))
        self.assertTrue(validate([1], {"items": False}))

    def test_fn_glyph_shortcuts_pass(self):
        for value in ("🌐F", "🌐F5", "⌘🌐K"):
            self.assertIsNone(config_files.shortcut_problem(value), value)

    def test_unknown_keywords_ignored(self):
        self.assertFalse(validate("x", {"type": "string", "format": "uri", "x-ardia": True, "$ref": "#/nowhere"}))

    def test_theme_values(self):
        colour = "must be a colour (#RGB, #RRGGBB, #RRGGBBAA, or rgb or rgba with r, g, b from 0 to 255 and a from 0 to 1)"
        cases = [
            ({"dark": {"accent": "#12"}}, f"dark.accent {colour}"),
            ({"dark": {"accent": "rgb(300,0,0)"}}, f"dark.accent {colour}"),
            ({"dark": {"accent": "rgb(01,0,0)"}}, f"dark.accent {colour}"),
            ({"light": {"panel": "rgba(0,0,0,1.5)"}}, f"light.panel {colour}"),
            ({"dark": {"accent": 3}}, f"dark.accent {colour}"),
            ({"dark": {"grain": 2}}, "dark.grain must be a number from 0 to 1"),
            ({"dark": {"grain": "0.1"}}, "dark.grain must be a number from 0 to 1"),
            ({"dark": {"tabSelectedShadowRadius": 101}}, "dark.tabSelectedShadowRadius must be a number from 0 to 100"),
            ({"dark": {"tabSelectedBorder": ["#fff"]}}, "dark.tabSelectedBorder must be two colours, each a colour (#RGB, #RRGGBB, #RRGGBBAA, or rgb or rgba with r, g, b from 0 to 255 and a from 0 to 1)"),
            ({"dark": {"acent": "#fff"}}, "dark.acent isn't a colour role (did you mean accent or onAccent?)"),
            ({"dark": {"dark": True}}, "dark.dark isn't a colour role (did you mean mark?)"),
            ({"dark": []}, "dark must be an object of colour roles"),
            ({"dark": None}, "dark must be an object of colour roles"),
            ({"drak": {}}, "drak isn't a theme key (dark, light, type, metrics, layout, icons) (did you mean dark?)"),
            ({"colors": {}}, "colors isn't a theme key (dark, light, type, metrics, layout, icons)"),
        ]
        for document, message in cases:
            with self.subTest(document=document):
                self.assertEqual([p.message for p in config_cli.theme_problems(document, THEME_SCHEMA)], [message])
        for good in ("#FFF", "#ffffff", "#FFFFFFC7", "rgb(1, 2, 3)", "rgba(18,18,18,0.5)", "rgba(0,0,0,1)", "rgba(0,0,0,.5)", "rgba(255,255,255,1.00)"):
            self.assertTrue(config_cli.is_colour(good), good)
        for bad in ("#ffff", "rgb(256,0,0)", "rgba(0,0,0,2)", "rgba(0,0,0,00.5)", "red", "#fff\n"):
            self.assertFalse(config_cli.is_colour(bad), bad)

    def look_messages(self, document, schema=THEME_SCHEMA):
        return [p.message for p in config_cli.theme_problems(document, schema)]

    def test_look_problems_in_the_apps_words(self):
        self.assertEqual(self.look_messages(BAD_LOOK), BAD_LOOK_PROBLEMS)

    def test_look_blocks_that_arent_objects(self):
        self.assertEqual(self.look_messages({"type": "Avenir", "metrics": [], "layout": {"hide": "pinned"}, "icons": 3}), [
            "type must be an object",
            "metrics must be an object",
            f"layout.hide must be a list of parts ({PARTS})",
            "icons must be an object of SF Symbol names",
        ])

    def test_look_good_values_pass(self):
        good = {
            "type": {"family": "Avenir Next", "mono": "SF Mono", "scale": 1.1, "sizes": {"body": 14, "badge": 7}, "weights": {"medium": "600", "bold": 800, "regular": 400.0}},
            "metrics": {"rowHeight": 40, "rowGap": 0, "pinnedHeight": 72, "sidebarWidth": 260, "radius": {"row": 14, "pinned": 18, "panel": 28, "sheet": 32, "tile": 24}},
            "layout": {"hide": ["pinned", "newTab", "pinned"], "addressField": "bottom", "newTab": "top"},
            "icons": {"plus": "plus.circle", "sidebar.left": "rectangle.lefthalf.inset.filled"},
        }
        self.assertEqual(self.look_messages(good), [])
        self.assertEqual(self.look_messages(good, None), [])
        self.assertEqual(self.look_messages(LOOK_DEFAULTS), [])

    def test_look_edge_values(self):
        cases = [
            ({"type": {"family": "x" * 64}}, []),
            ({"type": {"family": "x" * 65}}, [f"type.family {FAMILY}"]),
            ({"type": {"family": "Avenir\n"}}, [f"type.family {FAMILY}"]),
            ({"type": {"weights": {"bold": True}}}, ['type.weights.bold must be a weight from "100" to "900" in steps of 100']),
            ({"type": {"weights": {"bold": 750}}}, ['type.weights.bold must be a weight from "100" to "900" in steps of 100']),
            ({"metrics": {"rowHeight": True}}, ["metrics.rowHeight must be a number from 24 to 56"]),
            ({"metrics": {"sidebarWidth": 100}}, ["metrics.sidebarWidth must be a number from 160 to 400"]),
            ({"metrics": {"rowheight": 30}}, ["metrics.rowheight isn't a metrics key (rowHeight, rowGap, pinnedHeight, sidebarWidth, radius) (did you mean rowHeight?)"]),
            ({"layout": {"newTab": None}}, ["layout.newTab must be one of top, bottom"]),
            ({"layout": {"hide": [{"a": 1}, 2.0]}}, [f'layout.hide has {{"a":1}}, which isn\'t a part ({PARTS})', f"layout.hide has 2, which isn't a part ({PARTS})"]),
            ({"layout": {"position": "left"}}, ["layout.position isn't a layout key (hide, addressField, newTab)"]),
            ({"icons": {"plus": 3}}, [f"icons.plus must be {SYMBOL}"]),
            ({"icons": {"plus.": "minus"}}, [f'icons has "plus.", which isn\'t {SYMBOL}']),
        ]
        for document, messages in cases:
            with self.subTest(document=document):
                self.assertEqual(self.look_messages(document), messages)
                self.assertEqual(self.look_messages(document, None), messages)

    def test_look_spec_comes_from_the_schema(self):
        schema = json.loads(json.dumps(THEME_SCHEMA))
        schema["properties"]["metrics"]["properties"]["rowHeight"]["maximum"] = 80
        schema["properties"]["layout"]["properties"]["hide"]["items"]["enum"].append("toolbar")
        self.assertEqual(self.look_messages({"metrics": {"rowHeight": 70}, "layout": {"hide": ["toolbar"]}}, schema), [])
        del schema["properties"]["icons"]
        self.assertEqual(self.look_messages({"icons": {}}, schema), ["icons isn't a theme key (dark, light, type, metrics, layout)"])

    def test_built_in_look_matches_the_schema(self):
        from_schema = {k: without_descriptions(v) for k, v in config_cli.look_specs(THEME_SCHEMA).items()}
        self.assertEqual(from_schema, config_cli.BUILT_IN_LOOK)
        self.assertEqual(config_cli.look_defaults(THEME_SCHEMA), LOOK_DEFAULTS)
        self.assertEqual(config_cli.look_defaults(None), LOOK_DEFAULTS)
        self.assertEqual(self.look_messages(BAD_LOOK, None), BAD_LOOK_PROBLEMS)
        self.assertEqual(self.look_messages({"colors": {}}, None), ["colors isn't a theme key (dark, light, type, metrics, layout, icons)"])

    def test_theme_values_without_schema(self):
        problems = config_cli.theme_problems({"dark": {"accent": "blue", "grain": 5, "whatever": "#fff"}}, None)
        self.assertEqual([p.message for p in problems], [
            "dark.accent must be a colour (#RGB, #RRGGBB, #RRGGBBAA, or rgb or rgba with r, g, b from 0 to 255 and a from 0 to 1)",
            "dark.grain must be a number from 0 to 1",
        ])


class Themes(Sandbox):
    def setUp(self):
        super().setUp()
        self.install_schemas()

    def test_new_writes_every_role(self):
        out, _ = self.ok("theme", "new", "nord")
        path = self.folder / "themes" / "nord.json"
        self.assertEqual(out.strip(), str(path))
        document = json.loads(path.read_text())
        self.assertEqual(document["$schema"], "../theme.schema.json")
        for mode in ("dark", "light"):
            self.assertEqual(document[mode], config_cli.theme_defaults(THEME_SCHEMA, mode))
        self.assertEqual(document["dark"]["accent"], "#4A77D4")
        self.assertEqual(document["light"]["accent"], "#6395FC")
        self.fails("theme", "new", "nord")
        self.assertEqual(json.loads(path.read_text()), document)

    def test_new_writes_look_defaults_and_passes_check(self):
        self.ok("theme", "new", "nord")
        document = json.loads((self.folder / "themes" / "nord.json").read_text())
        self.assertEqual(list(document), ["$schema", "dark", "light", "type", "metrics", "layout", "icons"])
        self.assertEqual({k: document[k] for k in LOOK_DEFAULTS}, LOOK_DEFAULTS)
        self.assertNotIn("family", document["type"])
        self.assertNotIn("sidebarWidth", document["metrics"])
        self.assertNotIn("newTab", document["layout"])
        out, _ = self.ok("theme", "check", "nord")
        self.assertEqual(out.strip(), "themes/nord.json: ok")

    def test_new_from_copies_look_key_by_key(self):
        themes = self.folder / "themes"
        themes.mkdir(parents=True)
        base = {
            "type": {"family": "Avenir Next", "sizes": {"body": 14}, "weights": {"bold": 800}},
            "metrics": {"sidebarWidth": 260, "radius": {"row": 14}},
            "layout": {"hide": ["pinned", "profile"], "newTab": "bottom"},
            "icons": {"plus": "plus.circle"},
        }
        (themes / "base.json").write_text(json.dumps(base))
        self.ok("theme", "new", "copy", "--from", "base")
        document = json.loads((themes / "copy.json").read_text())
        self.assertEqual(document["type"]["family"], "Avenir Next")
        self.assertEqual(document["type"]["sizes"], {**LOOK_DEFAULTS["type"]["sizes"], "body": 14})
        self.assertEqual(document["type"]["weights"]["bold"], 800)
        self.assertEqual(document["type"]["mono"], "Menlo")
        self.assertEqual(document["metrics"]["sidebarWidth"], 260)
        self.assertEqual(document["metrics"]["radius"], {**LOOK_DEFAULTS["metrics"]["radius"], "row": 14})
        self.assertEqual(document["metrics"]["rowHeight"], 34)
        self.assertEqual(document["layout"], {"hide": ["pinned", "profile"], "addressField": "top", "newTab": "bottom"})
        self.assertEqual(document["icons"], {"plus": "plus.circle"})
        self.ok("theme", "check", "copy")

    def test_check_reports_look_problems_per_key(self):
        themes = self.folder / "themes"
        themes.mkdir(parents=True)
        (themes / "bad.json").write_text(json.dumps(BAD_LOOK))
        self.write_config({"theme": "bad", "settings": {}})
        out, _ = self.fails("theme", "check", "bad")
        self.assertEqual(out.splitlines(), [f"themes/bad.json: {m}" for m in BAD_LOOK_PROBLEMS])
        out, _ = self.fails("config", "check")
        self.assertIn("config.json: ok", out)
        self.assertIn("themes/bad.json: metrics.rowHeight must be a number from 24 to 56", out)
        out, _ = self.fails("theme", "check", "bad", "--json")
        problems = json.loads(out)["files"][0]["problems"]
        self.assertIn({"key": "layout.hide", "message": f'layout.hide has "toolbar", which isn\'t a part ({PARTS})'}, problems)
        self.assertIn({"key": "type.sizes.huge", "message": BAD_LOOK_PROBLEMS[4]}, problems)

    def test_new_from_copies(self):
        themes = self.folder / "themes"
        themes.mkdir(parents=True)
        (themes / "base.json").write_text(json.dumps({"dark": {"accent": "#88C0D0", "custom": "#000"}, "note": "mine"}))
        self.ok("theme", "new", "copy", "--from", "base")
        document = json.loads((themes / "copy.json").read_text())
        self.assertEqual(document["dark"]["accent"], "#88C0D0")
        self.assertEqual(document["dark"]["custom"], "#000")
        self.assertEqual(document["light"]["accent"], "#6395FC")
        self.assertEqual(document["note"], "mine")
        _, err = self.fails("theme", "new", "other", "--from", "bsae")
        self.assertIn("did you mean base", err)

    def test_new_refuses_dangling_link(self):
        themes = self.folder / "themes"
        themes.mkdir(parents=True)
        os.symlink(self.temp / "gone.json", themes / "nord.json")
        self.fails("theme", "new", "nord")
        self.assertFalse((self.temp / "gone.json").exists())

    def test_names_never_escape(self):
        for name in ("../evil", "a/b", "Nord", "-x", "", ".hidden", "nord\n", "nord.json", "/abs"):
            with self.subTest(name=name):
                _, err = self.fails("theme", "new", "--", name)
                self.assertIn("isn't a theme name", err)
                self.fails("theme", "use", "--", name)
                self.fails("theme", "new", "ok", f"--from={name}")
                self.fails("theme", "check", "--", name)
        self.assertFalse((self.temp / "evil.json").exists())
        self.assertFalse((self.data / "evil.json").exists())
        self.assertFalse(any(self.folder.glob("themes/ok*")))

    def test_use_list_check(self):
        self.ok("theme", "new", "nord")
        self.ok("theme", "new", "dracula")
        out, _ = self.ok("theme", "use", "nord")
        self.assertEqual(out.strip(), "theme: nord")
        self.assertEqual(list(self.config()), ["$schema", "theme", "settings"])
        self.assertEqual(self.config()["theme"], "nord")
        out, _ = self.ok("theme", "list")
        self.assertEqual(out.splitlines(), ["  dracula", "* nord"])
        out, _ = self.ok("theme", "list", "--json")
        self.assertEqual(json.loads(out)["active"], "nord")
        out, _ = self.ok("theme", "check")
        self.assertEqual(out.strip(), "themes/nord.json: ok")
        path = self.folder / "themes" / "nord.json"
        document = json.loads(path.read_text())
        document["dark"]["accent"] = "rgb(1,2)"
        path.write_text(json.dumps(document))
        out, _ = self.fails("theme", "check", "nord")
        self.assertIn("themes/nord.json: dark.accent must be a colour", out)
        out, _ = self.fails("theme", "check", str(path), "--json")
        self.assertFalse(json.loads(out)["ok"])
        out, _ = self.fails("config", "check")
        self.assertIn("config.json: ok", out)
        self.assertIn("themes/nord.json: dark.accent", out)
        self.ok("theme", "use", "none")
        self.assertIsNone(self.config()["theme"])
        _, err = self.fails("theme", "use", "nrod")
        self.assertIn("did you mean nord", err)

    def test_use_inserts_theme_after_schema(self):
        self.ok("theme", "new", "nord")
        self.write_config({"$schema": "./config.schema.json", "settings": {"tabLayout": "top"}, "extra": 1})
        self.ok("theme", "use", "nord")
        self.assertEqual(list(self.config()), ["$schema", "theme", "settings", "extra"])

    def test_check_reports_missing_theme(self):
        self.write_config({"theme": "nord", "settings": {}})
        out, _ = self.fails("config", "check")
        self.assertIn("theme nord doesn't exist", out)
        out, _ = self.ok("theme", "list")
        self.assertIn("* nord (missing", out)

    def test_check_json(self):
        self.write_config({"theme": None, "settings": {"selectedTabGlow": "glowy"}})
        out, _ = self.fails("config", "check", "--json")
        report = json.loads(out)
        self.assertFalse(report["ok"])
        self.assertEqual(report["files"][0]["problems"], [{"key": "selectedTabGlow", "message": "selectedTabGlow must be full, soft or off"}])

    def test_check_unparseable(self):
        self.folder.mkdir(parents=True)
        (self.folder / "config.json").write_text('{"settings": {"a": 1,}}')
        out, _ = self.fails("config", "check")
        self.assertIn("config.json doesn't parse: line 1", out)

    def test_reads_refuse_fifo_and_big_files(self):
        self.folder.mkdir(parents=True)
        os.mkfifo(self.folder / "config.json")
        _, err = self.fails("config", "get", "tabLayout")
        self.assertIn("isn't a regular file", err)
        os.unlink(self.folder / "config.json")
        (self.folder / "config.json").write_text('{"settings": {}, "pad": "' + "x" * (1024 * 1024) + '"}')
        _, err = self.fails("config", "set", "tabLayout", "top")
        self.assertIn("larger than 1 MB", err)


class Edit(Sandbox):
    def test_fallback_waits_with_open(self):
        with mock.patch("subprocess.call", return_value=0) as call:
            out, _ = self.ok("config", "edit")
        call.assert_called_once_with(["vi", str(self.folder / "config.json")])
        self.assertIn("config.json: ok", out)

    def test_visual_then_editor(self):
        def editor(argv):
            Path(argv[-1]).write_text('{"settings": {"cliControl": true}}')
            return 0

        with mock.patch.dict(os.environ, {"VISUAL": "code --wait", "EDITOR": "vim"}), mock.patch("subprocess.call", side_effect=editor) as call:
            out, _ = self.fails("config", "edit")
        self.assertEqual(call.call_args[0][0][:2], ["code", "--wait"])
        self.assertIn("cliControl can't be set", out)
        with mock.patch.dict(os.environ, {"EDITOR": "nano"}), mock.patch("subprocess.call", return_value=3) as call:
            self.fails("config", "edit")
        self.assertEqual(call.call_args[0][0][0], "nano")


class NoConnection(Sandbox):
    def test_never_connects(self):
        self.install_schemas()
        with mock.patch("socket.socket", side_effect=AssertionError("connected")), mock.patch.object(endpoint, "resolve", side_effect=AssertionError("resolved")):
            self.ok("config", "init")
            self.ok("config", "set", "tabLayout", "top")
            self.ok("config", "list")
            self.ok("config", "check")
            self.ok("theme", "new", "nord")
            self.ok("theme", "use", "nord")
            self.ok("theme", "list")
            self.ok("theme", "check")

    def test_help(self):
        for argv in (["config", "--help"], ["theme", "--help"], ["config", "set", "--help"], ["theme", "new", "--help"]):
            status, out, _ = self.run_cli(*argv)
            self.assertEqual(status, 0)
            self.assertIn("usage: ardia", out)


if __name__ == "__main__":
    unittest.main()
