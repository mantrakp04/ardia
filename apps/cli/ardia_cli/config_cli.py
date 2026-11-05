import json
import math
import os
import re
import sys
import textwrap
from pathlib import Path

from ardia_cli import config_files as files
from ardia_cli.config_files import ConfigError, Places
from ardia_cli.schema_check import Problem, describe, did_you_mean, format_path, show, validate

CONFIG_DESCRIPTION = """\
Set Ardia up from ~/.config/ardia/config.json, dotfiles style. Ardia reads the file at launch and whenever it
changes, and never writes it; these commands edit it for you and check it against the schema Ardia writes.
None of them need Ardia running.

The config folder is ~/.config/ardia, or <data dir>/config with --data-dir or $ARDIA_DATA_DIR. Keys, allowed
values and defaults come from config.schema.json in the config folder, else <data dir>/config-schema/ (the named
data dir, else the installed app's).

Commands:
  path               print the config folder
  init               create the folder, config.json and the schemas (never overwrites)
  get [KEY]          print a setting from the file, or the whole file
  set KEY VALUE      check VALUE and write it (KEY is a setting or shortcuts.<command id>)
  unset KEY          take a key out of the file (Ardia keeps its current value)
  list               every setting: allowed values, default and the file's value
  edit               open config.json in $VISUAL, $EDITOR or vi, then check it
  check              check config.json and the theme it names

Exit status: 0 done, 1 a check failed or the input is wrong.
"""
THEME_DESCRIPTION = """\
Themes are colour overrides in <config folder>/themes/NAME.json, with a "dark" and a "light" block of colour
roles. config.json's "theme" picks one; editing the active theme restyles Ardia at once.

Colours: #RGB, #RRGGBB, #RRGGBBAA, rgb(r,g,b) or rgba(r,g,b,a) (r, g, b 0-255, a 0-1). grain and the ...Opacity
roles take numbers 0-1, the ...Radius roles 0-100, tabSelectedBorder a list of two colours.

Commands:
  new NAME [--from THEME]   write themes/NAME.json with every role (never overwrites)
  use NAME|none             make NAME the active theme, or go back to Ardia's own
  list                      the themes, the active one marked
  check [NAME|FILE]         check a theme (default: the active one)

Exit status: 0 done, 1 a check failed or the input is wrong.
"""
SET_DESCRIPTION = """\
Write one setting to config.json. VALUE is parsed as JSON, else taken as a string, and checked against the schema
first. The file is rewritten even when it already holds the value, so a running Ardia applies it again.

Examples:
  ardia config set tabLayout top
  ardia config set glassTintAmount 0.5
  ardia config set shortcuts.newTab cmd+shift+n
  ardia config set shortcuts.reopenClosedTab ''
"""
SHORTCUT_HELP = (
    "Shortcuts are one string per command: modifiers cmd, opt (option, alt), ctrl (control), shift, fn, joined with +,"
    " then a character, f1-f20, space, tab, return, escape, delete, up, down, left, right, home, end, pageup or"
    " pagedown; or glyphs like ⌘⇧T; '' unbinds."
)
DATA_DIR_HELP = "the Ardia data dir; the config folder is <DIR>/config (default: $ARDIA_DATA_DIR, else ~/.config/ardia)"
CHANNEL = r"\s*(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\s*"
ALPHA = r"\s*(?:0|1|0?\.[0-9]+|1\.0+)\s*"
COLOUR = re.compile(
    rf"#[0-9A-Fa-f]{{3}}|#[0-9A-Fa-f]{{6}}|#[0-9A-Fa-f]{{8}}"
    rf"|rgb\({CHANNEL},{CHANNEL},{CHANNEL}\)|rgba\({CHANNEL},{CHANNEL},{CHANNEL},{ALPHA}\)"
)
COLOUR_RULE = "a colour (#RGB, #RRGGBB, #RRGGBBAA, or rgb or rgba with r, g, b from 0 to 255 and a from 0 to 1)"


def add_parsers(commands, formatter):
    config = commands.add_parser("config", help="read, write and check config.json", description=CONFIG_DESCRIPTION, formatter_class=formatter)
    sub = config.add_subparsers(dest="config_command", metavar="<command>")

    def command(name, help_text, description=None):
        parser = sub.add_parser(name, help=help_text, description=description or help_text[0].upper() + help_text[1:] + ".", formatter_class=formatter)
        parser.add_argument("--data-dir", metavar="DIR", help=DATA_DIR_HELP)
        return parser

    command("path", "print the config folder")
    command("init", "create the config folder, config.json and the schemas Ardia wrote; never overwrites a file")
    get = command("get", "print a setting from config.json, or the whole file", "Print a setting from config.json (exit 1 when the file doesn't set it), or the whole file.\nKEY is a setting name or shortcuts.<command id>.")
    get.add_argument("key", nargs="?", metavar="KEY", help="a setting name or shortcuts.<command id>")
    get.add_argument("--json", action="store_true", help="print JSON")
    put = command("set", "check a value and write it to config.json", SET_DESCRIPTION + "\n" + textwrap.fill(SHORTCUT_HELP, 116))
    put.add_argument("key", metavar="KEY", help="a setting name or shortcuts.<command id>")
    put.add_argument("value", metavar="VALUE", help="JSON, else a plain string")
    unset = command("unset", "take a key out of config.json", "Take a key out of config.json. Ardia keeps the value it has; to go back to the default, set the default.")
    unset.add_argument("key", metavar="KEY", help="a setting name or shortcuts.<command id>")
    listing = command("list", "list every setting with its allowed values, default and file value")
    listing.add_argument("--json", action="store_true", help="print JSON")
    command("edit", "open config.json in $VISUAL, $EDITOR, else vi, then check it", "Open config.json (created first if needed) in $VISUAL, $EDITOR, else vi, wait for the editor to exit, then\ncheck it like ardia config check.")
    check = command("check", "check config.json and the theme it names", "Check config.json and the theme it names, the way Ardia reads them. Exit 1 on any problem.")
    check.add_argument("--json", action="store_true", help="print JSON")

    theme = commands.add_parser("theme", help="make, pick and check colour themes", description=THEME_DESCRIPTION, formatter_class=formatter)
    tsub = theme.add_subparsers(dest="theme_command", metavar="<command>")

    def theme_command(name, help_text, description=None):
        parser = tsub.add_parser(name, help=help_text, description=description or help_text[0].upper() + help_text[1:] + ".", formatter_class=formatter)
        parser.add_argument("--data-dir", metavar="DIR", help=DATA_DIR_HELP)
        return parser

    new = theme_command("new", "write themes/NAME.json with every colour role", "Write themes/NAME.json with every dark and light colour role, from Ardia's defaults or from another\ntheme. Names use lowercase letters, digits, - and _. It never overwrites a file.")
    new.add_argument("name", metavar="NAME", help="the theme's name")
    new.add_argument("--from", dest="source", metavar="THEME", help="start from this theme instead of Ardia's defaults")
    use = theme_command("use", "make a theme the active one", "Set theme in config.json (created first if needed). none goes back to Ardia's own palette.")
    use.add_argument("name", metavar="NAME", help="a theme name, or none")
    tlist = theme_command("list", "list the themes, the active one marked with *")
    tlist.add_argument("--json", action="store_true", help="print JSON")
    tcheck = theme_command("check", "check a theme", "Check a theme by name or file (default: the active one). Exit 1 on any problem.")
    tcheck.add_argument("target", nargs="?", metavar="NAME|FILE", help="a theme name or a path to a theme file")
    tcheck.add_argument("--json", action="store_true", help="print JSON")
    return config, theme


def say(text: str) -> None:
    sys.stdout.write(text + "\n")
    sys.stdout.flush()


def complain(text: str) -> None:
    sys.stdout.flush()
    sys.stderr.write(text + "\n")
    sys.stderr.flush()


def run_config(args, parser) -> int:
    handlers = {"path": config_path, "init": config_init, "get": config_get, "set": config_set, "unset": config_unset, "list": config_list, "edit": config_edit, "check": config_check}
    handler = handlers.get(args.config_command)
    if handler is None:
        parser.parse_args(["config", "--help"])
        return 0
    return guarded("ardia config", handler, args)


def run_theme(args, parser) -> int:
    handlers = {"new": theme_new, "use": theme_use, "list": theme_list, "check": theme_check}
    handler = handlers.get(args.theme_command)
    if handler is None:
        parser.parse_args(["theme", "--help"])
        return 0
    return guarded("ardia theme", handler, args)


def guarded(prefix: str, handler, args) -> int:
    try:
        return handler(args, files.places(args.data_dir))
    except ConfigError as error:
        complain(f"{prefix}: {error}")
        return 1
    except OSError as error:
        name = f"{error.filename}: " if error.filename else ""
        complain(f"{prefix}: {name}{error.strerror or error}")
        return 1


def config_path(args, where: Places) -> int:
    say(str(where.folder))
    return 0


def config_init(args, where: Places) -> int:
    for folder in (where.folder, where.themes):
        if folder.is_dir():
            continue
        folder.mkdir(parents=True, exist_ok=True)
        say(f"created {folder}/")
    create(where.config, files.dump(files.new_config()))
    for name in (files.CONFIG_SCHEMA, files.THEME_SCHEMA):
        target = where.folder / name
        source = where.data / files.SCHEMA_FOLDER / name
        if os.path.lexists(target):
            say(f"kept {target}")
            continue
        try:
            files.read_object(source, str(source))
            text = files.read_text(source)
        except FileNotFoundError:
            complain(f"ardia config: no {name} in {source.parent} yet; Ardia writes it at launch and copies it here")
            continue
        create(target, text)
    return 0


def create(path: Path, text: str) -> None:
    try:
        files.write_text(path, text, overwrite=False)
        say(f"created {path}")
    except FileExistsError:
        say(f"kept {path}")


def split_key(key: str) -> list[str]:
    head, dot, rest = key.partition(".")
    if dot and head == "shortcuts" and rest:
        return ["shortcuts", rest]
    return [key]


def config_schema(where: Places) -> files.Schema:
    found = files.find_schema(where, files.CONFIG_SCHEMA)
    if found.warning:
        complain(f"ardia config: {found.warning}")
    return found


def check_key(parts: list[str], specs: dict) -> None:
    top = parts[0]
    if top in files.RESERVED_SETTINGS:
        raise ConfigError(f"{top} can't be set from config.json; change it in Ardia's Settings")
    if "." in top and not specs.get(top):
        raise ConfigError(f"{top} isn't a setting; only shortcuts.<command id> takes a dot")
    if specs and top not in specs:
        raise ConfigError(f"unknown setting {top}{did_you_mean(top, specs)}")


def value_problems(parts: list[str], value, specs: dict) -> list[Problem]:
    top = parts[0]
    spec = specs.get(top)
    if len(parts) == 2:
        problems = validate({parts[1]: value}, spec, ("shortcuts",), False) if spec else []
        if not problems:
            problems = shortcut_problems({parts[1]: value})
        return problems
    problems = validate(value, spec, (top,), False) if spec else []
    if not problems and top == "shortcuts" and isinstance(value, dict):
        problems = shortcut_problems(value)
    return problems


def shortcut_problems(shortcuts: dict, skip=()) -> list[Problem]:
    problems = []
    for command, value in shortcuts.items():
        path = ("shortcuts", command)
        if path in skip:
            continue
        problem = files.shortcut_problem(value)
        if problem:
            problems.append(Problem(path, f"shortcuts.{command}: {problem}"))
    return problems


def parse_value(text: str) -> list:
    try:
        parsed = files.parse_json(text)
    except ValueError:
        return [text]
    return [parsed] if isinstance(parsed, str) else [parsed, text]


def config_set(args, where: Places) -> int:
    parts = split_key(args.key)
    schema = config_schema(where)
    specs = files.setting_specs(schema.document)
    check_key(parts, specs)
    candidates = parse_value(args.value)
    chosen = None
    first_problems = None
    for candidate in candidates:
        problems = value_problems(parts, candidate, specs)
        if not problems:
            chosen = candidate
            break
        first_problems = first_problems or problems
    if chosen is None and first_problems:
        for problem in first_problems:
            complain(f"ardia config: {problem.message}")
        return 1
    if chosen is None:
        chosen = candidates[0]
    document, created = files.load_config(where, create=True)
    settings = document.get("settings")
    settings = dict(settings) if isinstance(settings, dict) else {}
    if len(parts) == 2:
        shortcuts = settings.get("shortcuts")
        if shortcuts is not None and not isinstance(shortcuts, dict):
            raise ConfigError("settings.shortcuts in config.json isn't an object; fix it or unset shortcuts first")
        shortcuts = dict(shortcuts or {})
        shortcuts[parts[1]] = chosen
        settings["shortcuts"] = shortcuts
    else:
        settings[parts[0]] = chosen
    document = files.with_key(document, "settings", settings)
    files.save_config(where, document, created)
    if created:
        complain(f"ardia config: created {where.config}")
    if schema.document is None:
        complain(f"ardia config: no {files.CONFIG_SCHEMA} found (Ardia writes one at launch), so {args.key} was written without checking it")
    say(f"{args.key} = {json.dumps(chosen, ensure_ascii=False)}")
    return 0


def config_unset(args, where: Places) -> int:
    parts = split_key(args.key)
    schema = config_schema(where)
    specs = files.setting_specs(schema.document)
    if not os.path.lexists(where.config):
        if specs and parts[0] not in specs and parts[0] not in files.RESERVED_SETTINGS:
            raise ConfigError(f"unknown setting {parts[0]}{did_you_mean(parts[0], specs)}")
        say(f"{args.key} isn't in config.json")
        return 0
    document, _ = files.load_config(where)
    settings = document.get("settings")
    settings = dict(settings) if isinstance(settings, dict) else {}
    holder = settings
    if len(parts) == 2:
        holder = settings.get("shortcuts")
        holder = dict(holder) if isinstance(holder, dict) else {}
    leaf = parts[-1]
    if leaf not in holder:
        top = parts[0]
        if specs and top not in specs and top not in files.RESERVED_SETTINGS and top not in settings:
            raise ConfigError(f"unknown setting {top}{did_you_mean(top, specs)}")
        say(f"{args.key} isn't in config.json")
        return 0
    del holder[leaf]
    if len(parts) == 2:
        settings["shortcuts"] = holder
    document["settings"] = settings
    files.save_config(where, document, False)
    say(f"removed {args.key}; Ardia keeps its current value")
    return 0


def config_get(args, where: Places) -> int:
    if args.key is None:
        try:
            text = files.read_text(where.config)
        except FileNotFoundError:
            raise ConfigError(f"there's no {where.config} yet (ardia config init creates it)") from None
        if args.json:
            try:
                document = files.parse_json(text)
            except ValueError as error:
                raise ConfigError(f"{files.CONFIG_FILE} doesn't parse: {error}") from None
            say(json.dumps(document, indent=2, ensure_ascii=False))
        else:
            sys.stdout.write(text if text.endswith("\n") or not text else text + "\n")
            sys.stdout.flush()
        return 0
    parts = split_key(args.key)
    document, _ = files.load_config(where)
    value = document.get("settings") or {}
    for part in parts:
        if not isinstance(value, dict) or part not in value:
            specs = files.setting_specs(files.find_schema(where, files.CONFIG_SCHEMA).document)
            if specs and parts[0] not in specs and parts[0] not in files.RESERVED_SETTINGS:
                raise ConfigError(f"unknown setting {parts[0]}{did_you_mean(parts[0], specs)}")
            default = files.sub(specs.get(parts[0]), "default") if len(parts) == 1 else None
            hint = f" (Ardia's default: {cell(default)})" if len(parts) == 1 and isinstance(specs.get(parts[0]), dict) and "default" in specs[parts[0]] else ""
            complain(f"ardia config: config.json doesn't set {args.key}{hint}")
            return 1
        value = value[part]
    say(json.dumps(value, ensure_ascii=False) if args.json or not isinstance(value, str) else value)
    return 0


def cell(value) -> str:
    if isinstance(value, str) and value:
        return value
    return json.dumps(value, ensure_ascii=False)


def config_list(args, where: Places) -> int:
    schema = config_schema(where)
    specs = files.setting_specs(schema.document)
    try:
        document, _ = files.load_config(where)
        settings = document.get("settings") or {}
    except ConfigError as error:
        if where.config.exists() or os.path.lexists(where.config):
            complain(f"ardia config: {error}")
        settings = {}
    rows = []
    for key, spec in specs.items():
        row = {"key": key, "allowed": describe(spec)}
        if isinstance(spec, dict) and "default" in spec:
            row["default"] = spec["default"]
        if isinstance(spec, dict) and isinstance(spec.get("description"), str):
            row["description"] = spec["description"]
        if key in settings:
            row["value"] = settings[key]
        rows.append(row)
    for key, value in settings.items():
        if key not in specs:
            rows.append({"key": key, "allowed": "not a setting Ardia reads from the file" if specs or key in files.RESERVED_SETTINGS else "unknown (no schema)", "value": value})
    if schema.document is None:
        complain(f"ardia config: no {files.CONFIG_SCHEMA} found (Ardia writes one at launch); listing only what config.json sets")
    if args.json:
        say(json.dumps({"schema": str(schema.path) if schema.path else None, "settings": rows}, indent=2, ensure_ascii=False))
        return 0
    table = [("KEY", "ALLOWED", "DEFAULT", "FILE")]
    for row in rows:
        table.append((row["key"], row["allowed"], cell(row["default"]) if "default" in row else "", cell(row["value"]) if "value" in row else ""))
    widths = [min(max(len(r[i]) for r in table), 40) for i in range(3)]
    for row in table:
        say("  ".join(text.ljust(widths[i]) for i, text in enumerate(row[:3])) + "  " + row[3])
    return 0


def editor_command() -> list[str]:
    import shlex

    for variable in ("VISUAL", "EDITOR"):
        value = os.environ.get(variable, "").strip()
        if value:
            return shlex.split(value)
    return ["vi"]


def config_edit(args, where: Places) -> int:
    import subprocess

    if not os.path.lexists(where.config):
        where.folder.mkdir(parents=True, exist_ok=True)
        create(where.config, files.dump(files.new_config()))
    command = editor_command()
    try:
        status = subprocess.call(command + [str(where.config)])
    except OSError as error:
        raise ConfigError(f"couldn't start {command[0]}: {error.strerror or error}") from None
    if status != 0:
        complain(f"ardia config: {command[0]} exited with status {status}")
        return 1
    args.json = False
    return config_check(args, where)


def config_problems(document, schema: dict | None) -> list[Problem]:
    if not isinstance(document, dict):
        return [Problem((), "config.json must hold a JSON object")]
    problems = []
    settings = document.get("settings", {})
    if not isinstance(settings, dict):
        problems.append(Problem(("settings",), "settings must be an object"))
        settings = {}
    for key in settings:
        if key in files.RESERVED_SETTINGS:
            problems.append(Problem((key,), f"{key} can't be set from config.json; Ardia ignores it"))
    allowed = {k: v for k, v in settings.items() if k not in files.RESERVED_SETTINGS}
    if schema is not None:
        problems += validate(allowed, files.settings_schema(schema), (), False, noun="setting")
        outer = {k: v for k, v in document.items() if k != "settings"}
        problems += validate(outer, files.outer_schema(schema), (), True)
    shortcuts = allowed.get("shortcuts")
    if isinstance(shortcuts, dict):
        flagged = {p.path for p in problems}
        problems += shortcut_problems(shortcuts, skip=flagged)
    theme = document.get("theme")
    if theme is not None and not files.is_theme_name(theme) and not any(p.path == ("theme",) for p in problems):
        problems.append(Problem(("theme",), "theme must be null or a theme name (lowercase letters, digits, - and _)"))
    return problems


def number_range(role: str, spec=None):
    if isinstance(spec, dict) and is_number(spec.get("minimum")) and is_number(spec.get("maximum")):
        return spec["minimum"], spec["maximum"]
    if role == "grain" or role.endswith("Opacity"):
        return 0, 1
    if role.endswith("Radius"):
        return 0, 100
    return None


def is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def is_colour(value) -> bool:
    return isinstance(value, str) and COLOUR.fullmatch(value) is not None


def role_kind(sample):
    if isinstance(sample, str):
        return "colour"
    if is_number(sample):
        return "number"
    if isinstance(sample, list):
        return "pair"
    return None


def role_problem(role: str, value, kind: str, spec=None) -> str | None:
    if kind == "colour":
        return None if is_colour(value) else f"must be {COLOUR_RULE}"
    if kind == "pair":
        ok = isinstance(value, list) and len(value) == 2 and all(is_colour(v) for v in value)
        return None if ok else f"must be two colours, each {COLOUR_RULE}"
    span = number_range(role, spec)
    if is_number(value) and math.isfinite(value) and (span is None or span[0] <= value <= span[1]):
        return None
    return "must be a number" if span is None else f"must be a number from {show(span[0])} to {show(span[1])}"


def theme_problems(document, schema: dict | None) -> list[Problem]:
    if not isinstance(document, dict):
        return [Problem((), "must be an object")]
    problems = []
    for key in document:
        if key not in ("$schema",) + files.MODES:
            problems.append(Problem((key,), f"{key} isn't a theme key (dark, light){did_you_mean(key, files.MODES)}"))
    for mode in files.MODES:
        if mode not in document:
            continue
        roles = document[mode]
        if not isinstance(roles, dict):
            problems.append(Problem((mode,), f"{mode} must be an object of colour roles"))
            continue
        specs = files.role_specs(schema, mode)
        for role, value in roles.items():
            path = (mode, role)
            spec = specs.get(role) if schema is not None else None
            if schema is not None:
                kind = role_kind(spec.get("default")) if isinstance(spec, dict) else None
            else:
                kind = role_kind(value) if role != "dark" else None
            if kind is None:
                suggestion = did_you_mean(role, [r for r in specs if r != "dark"]) if schema is not None else ""
                problems.append(Problem(path, f"{mode}.{role} isn't a colour role{suggestion}"))
                continue
            problem = role_problem(role, value, kind, spec)
            if problem:
                problems.append(Problem(path, f"{mode}.{role} {problem}"))
    return problems


def check_theme_file(where: Places, path: Path, schema: dict | None) -> list[Problem]:
    try:
        document = files.read_json(path, where.show(path))
    except FileNotFoundError:
        return [Problem((), "doesn't exist")]
    except ConfigError as error:
        return [Problem((), str(error))]
    return theme_problems(document, schema)


def report(results, warnings, as_json: bool) -> int:
    ok = all(not problems for _, _, problems in results)
    if as_json:
        say(json.dumps({
            "ok": ok,
            "files": [{"file": str(path), "problems": [p.to_dict() for p in problems]} for path, _, problems in results],
            "warnings": warnings,
        }, indent=2, ensure_ascii=False))
        return 0 if ok else 1
    for warning in warnings:
        complain(f"warning: {warning}")
    for _, label, problems in results:
        if not problems:
            say(f"{label}: ok")
        for problem in problems:
            message = problem.message
            say(message if message.startswith(label) else f"{label}: {message}")
    return 0 if ok else 1


def config_check(args, where: Places) -> int:
    warnings = []
    config = files.find_schema(where, files.CONFIG_SCHEMA)
    themes = files.find_schema(where, files.THEME_SCHEMA)
    warnings += [w for w in (config.warning, themes.warning) if w]
    if config.document is None:
        warnings.append(f"no {files.CONFIG_SCHEMA} found (Ardia writes one at launch), so settings were checked only for syntax, shortcuts and the theme name")
    results = []
    try:
        document = files.read_json(where.config, files.CONFIG_FILE)
    except FileNotFoundError:
        raise ConfigError(f"there's no {where.config} yet (ardia config init creates it)") from None
    except ConfigError as error:
        results.append((where.config, files.CONFIG_FILE, [Problem((), str(error))]))
        return report(results, warnings, args.json)
    problems = config_problems(document, config.document)
    results.append((where.config, files.CONFIG_FILE, problems))
    theme = document.get("theme") if isinstance(document, dict) else None
    if files.is_theme_name(theme):
        path = where.theme(theme)
        if not path.exists():
            problems.append(Problem(("theme",), f"theme {theme} doesn't exist (no {where.show(path)}){did_you_mean(theme, files.theme_names(where))}"))
        else:
            if themes.document is None:
                warnings.append(f"no {files.THEME_SCHEMA} found, so unknown colour roles weren't checked")
            results.append((path, where.show(path), check_theme_file(where, path, themes.document)))
    return report(results, warnings, args.json)


def theme_defaults(schema: dict | None, mode: str) -> dict:
    return {role: spec["default"] for role, spec in files.role_specs(schema, mode).items() if isinstance(spec, dict) and "default" in spec and role != "dark"}


def theme_new(args, where: Places) -> int:
    files.check_theme_name(args.name)
    target = where.theme(args.name)
    if os.path.lexists(target):
        raise ConfigError(f"{target} already exists")
    schema = files.find_schema(where, files.THEME_SCHEMA)
    if schema.warning:
        complain(f"ardia theme: {schema.warning}")
    if args.source is None and schema.document is None:
        raise ConfigError(f"no {files.THEME_SCHEMA} found, so Ardia's colours aren't known yet; open Ardia once (it writes the schema), or use --from THEME")
    source = {}
    if args.source is not None:
        files.check_theme_name(args.source)
        path = where.theme(args.source)
        try:
            source = files.read_object(path, where.show(path))
        except FileNotFoundError:
            raise ConfigError(f"no theme named {args.source}{did_you_mean(args.source, files.theme_names(where))}") from None
    document = {"$schema": f"../{files.THEME_SCHEMA}"}
    for mode in files.MODES:
        given = source.get(mode) if isinstance(source.get(mode), dict) else {}
        roles = {}
        for role, default in theme_defaults(schema.document, mode).items():
            roles[role] = given.get(role, default)
        for role, value in given.items():
            roles.setdefault(role, value)
        document[mode] = roles
    for key, value in source.items():
        if key not in document:
            document[key] = value
    where.themes.mkdir(parents=True, exist_ok=True)
    try:
        files.write_json(target, document, overwrite=False)
    except FileExistsError:
        raise ConfigError(f"{target} already exists") from None
    say(str(target))
    return 0


def theme_use(args, where: Places) -> int:
    name = None if args.name == "none" else args.name
    if name is not None:
        files.check_theme_name(name)
        path = where.theme(name)
        if not path.exists():
            raise ConfigError(f"no theme named {name} in {where.themes}{did_you_mean(name, files.theme_names(where))} (ardia theme new {name} makes one)")
    document, created = files.load_config(where, create=True)
    document = files.with_key(document, "theme", name, after="$schema")
    files.save_config(where, document, created)
    if created:
        complain(f"ardia theme: created {where.config}")
    if name is None:
        say("theme: none (Ardia's own palette)")
        return 0
    schema = files.find_schema(where, files.THEME_SCHEMA)
    for problem in check_theme_file(where, path, schema.document):
        complain(f"warning: {where.show(path)}: {problem.message}")
    say(f"theme: {name}")
    return 0


def active_theme(where: Places):
    try:
        document = files.read_object(where.config, files.CONFIG_FILE)
    except FileNotFoundError:
        return None
    theme = document.get("theme")
    return theme if files.is_theme_name(theme) else None


def theme_list(args, where: Places) -> int:
    try:
        active = active_theme(where)
    except ConfigError as error:
        complain(f"ardia theme: {error}")
        active = None
    names = files.theme_names(where)
    missing = active is not None and active not in names
    if args.json:
        rows = [{"name": n, "path": str(where.theme(n)), "active": n == active} for n in names]
        say(json.dumps({"active": active, "missing": missing, "themes": rows}, indent=2, ensure_ascii=False))
        return 0
    for name in names:
        say(f"{'*' if name == active else ' '} {name}")
    if missing:
        say(f"* {active} (missing: no {where.show(where.theme(active))})")
    if not names and not missing:
        complain(f"ardia theme: no themes in {where.themes} yet (ardia theme new NAME makes one)")
    return 0


def theme_check(args, where: Places) -> int:
    target = args.target
    if target is None:
        target = active_theme(where)
        if target is None:
            raise ConfigError("config.json names no theme; give a NAME or FILE")
    if files.is_theme_name(target):
        path = where.theme(target)
        if not path.exists() and not Path(target).is_file():
            raise ConfigError(f"no theme named {target}{did_you_mean(target, files.theme_names(where))}")
        if not path.exists():
            path = Path(target)
    else:
        path = Path(target).expanduser()
        if not path.exists():
            raise ConfigError(f"{path} doesn't exist")
    schema = files.find_schema(where, files.THEME_SCHEMA)
    warnings = [schema.warning] if schema.warning else []
    if schema.document is None:
        warnings.append(f"no {files.THEME_SCHEMA} found, so unknown colour roles weren't checked")
    return report([(path, where.show(path), check_theme_file(where, path, schema.document))], warnings, args.json)
