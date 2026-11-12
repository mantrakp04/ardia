import json
import os
import re
import stat
import tempfile
from dataclasses import dataclass
from pathlib import Path

from ardia_cli import endpoint

CONFIG_FILE = "config.json"
CONFIG_SCHEMA = "config.schema.json"
THEME_SCHEMA = "theme.schema.json"
SCHEMA_FOLDER = "config-schema"
THEME_NAME = re.compile(r"[a-z0-9][a-z0-9_-]*")
RESERVED_SETTINGS = (
    "cliControl",
    "allowJavaScriptFromAppleEvents",
    "extensionSearchEngines",
    "defaultProfileId",
    "customSearchUrl",
    "customSearchEngines",
    "pageEngine",
    "websiteEngines",
    "protectedVideoInWebKit",
)
MODES = ("dark", "light")
MAX_FILE = 1024 * 1024


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class Places:
    folder: Path
    data: Path

    @property
    def config(self) -> Path:
        return self.folder / CONFIG_FILE

    @property
    def themes(self) -> Path:
        return self.folder / "themes"

    def theme(self, name: str) -> Path:
        check_theme_name(name)
        return self.themes / f"{name}.json"

    def schema_candidates(self, name: str) -> list[Path]:
        return [self.folder / name, self.data / SCHEMA_FOLDER / name]

    def show(self, path: Path) -> str:
        try:
            return str(path.relative_to(self.folder))
        except ValueError:
            return str(path)


def places(data_dir: str | None = None) -> Places:
    explicit = endpoint.explicit_data_root(data_dir)
    if explicit is not None:
        return Places(explicit / "config", explicit)
    return Places(Path.home() / ".config" / "ardia", endpoint.INSTALLED_DATA_DIR)


def is_theme_name(name) -> bool:
    return isinstance(name, str) and THEME_NAME.fullmatch(name) is not None


def check_theme_name(name) -> None:
    if not is_theme_name(name):
        raise ConfigError(f"{name!r} isn't a theme name: use lowercase letters, digits, - and _, starting with a letter or digit")


def _no_constants(token: str):
    raise ValueError(f"{token} isn't valid JSON")


def _finite(token: str) -> float:
    value = float(token)
    if value in (float("inf"), float("-inf")):
        raise ValueError(f"{token} is too large a number")
    return value


def parse_json(text: str):
    return json.loads(text, parse_constant=_no_constants, parse_float=_finite)


def read_text(path: Path) -> str:
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ConfigError(f"{path.name} isn't a regular file")
        chunks = []
        size = 0
        while size <= MAX_FILE:
            chunk = os.read(fd, MAX_FILE + 1 - size)
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
    finally:
        os.close(fd)
    raw = b"".join(chunks)
    if len(raw) > MAX_FILE:
        raise ConfigError(f"{path.name} is larger than 1 MB")
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ConfigError(f"{path.name} isn't UTF-8 text") from None


def read_json(path: Path, label: str | None = None):
    label = label or path.name
    try:
        text = read_text(path)
    except FileNotFoundError:
        raise
    except OSError as error:
        raise ConfigError(f"{label}: {error.strerror or error}") from None
    try:
        return parse_json(text)
    except json.JSONDecodeError as error:
        raise ConfigError(f"{label} doesn't parse: line {error.lineno} column {error.colno}: {error.msg}") from None
    except ValueError as error:
        raise ConfigError(f"{label} doesn't parse: {error}") from None


def read_object(path: Path, label: str | None = None) -> dict:
    document = read_json(path, label)
    if not isinstance(document, dict):
        raise ConfigError(f"{label or path.name} must hold a JSON object")
    return document


def dump(document) -> str:
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


def _default_mode() -> int:
    mask = os.umask(0)
    os.umask(mask)
    return 0o666 & ~mask


def write_text(path: Path, text: str, overwrite: bool = True) -> None:
    if not overwrite and os.path.lexists(path):
        raise FileExistsError(path)
    target = Path(os.path.realpath(path)) if overwrite and path.is_symlink() else path
    if overwrite and os.path.lexists(target) and not target.is_file():
        raise ConfigError(f"{path} isn't a regular file")
    try:
        mode = os.stat(target).st_mode & 0o7777 if overwrite else _default_mode()
    except FileNotFoundError:
        mode = _default_mode()
    fd, temp = tempfile.mkstemp(dir=target.parent, prefix=f".{target.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp, mode)
        if overwrite:
            os.replace(temp, target)
        else:
            os.link(temp, target)
    finally:
        try:
            os.unlink(temp)
        except FileNotFoundError:
            pass


def write_json(path: Path, document, overwrite: bool = True) -> None:
    write_text(path, dump(document), overwrite)


@dataclass
class Schema:
    path: Path | None
    document: dict | None
    warning: str | None = None


def find_schema(where: Places, name: str) -> Schema:
    warnings = []
    for candidate in where.schema_candidates(name):
        try:
            document = read_object(candidate, str(candidate))
        except FileNotFoundError:
            continue
        except ConfigError as error:
            warnings.append(f"skipped {error}")
            continue
        return Schema(candidate, document, "; ".join(warnings) or None)
    return Schema(None, None, "; ".join(warnings) or None)


def setting_specs(schema: dict | None) -> dict:
    settings = sub(schema, "properties", "settings")
    properties = settings.get("properties") if isinstance(settings, dict) else None
    return properties if isinstance(properties, dict) else {}


def settings_schema(schema: dict | None) -> dict:
    settings = sub(schema, "properties", "settings")
    return settings if isinstance(settings, dict) else {}


def outer_schema(schema: dict) -> dict:
    properties = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
    required = schema.get("required") if isinstance(schema.get("required"), list) else []
    outer = dict(schema)
    outer["properties"] = {k: v for k, v in properties.items() if k != "settings"}
    outer["required"] = [r for r in required if r != "settings"]
    return outer


def role_specs(schema: dict | None, mode: str) -> dict:
    properties = sub(schema, "properties", mode, "properties")
    return properties if isinstance(properties, dict) else {}


def sub(document, *keys):
    for key in keys:
        if not isinstance(document, dict):
            return None
        document = document.get(key)
    return document


def new_config() -> dict:
    return {"$schema": f"./{CONFIG_SCHEMA}", "theme": None, "settings": {}}


def load_config(where: Places, create: bool = False) -> tuple[dict, bool]:
    try:
        document = read_object(where.config, CONFIG_FILE)
    except FileNotFoundError:
        if os.path.lexists(where.config):
            raise ConfigError(f"{where.config} is a link to {os.readlink(where.config)}, which doesn't exist") from None
        if not create:
            raise ConfigError(f"there's no {where.config} yet (ardia config init creates it)") from None
        return new_config(), True
    if "settings" in document and not isinstance(document["settings"], dict):
        raise ConfigError(f"{CONFIG_FILE}: settings must be an object")
    return document, False


def save_config(where: Places, document: dict, created: bool) -> None:
    if created:
        where.folder.mkdir(parents=True, exist_ok=True)
        try:
            write_json(where.config, document, overwrite=False)
            return
        except FileExistsError:
            raise ConfigError(f"{where.config} appeared while this ran; run the command again") from None
    write_json(where.config, document)


def with_key(document: dict, key: str, value, after: str | None = None) -> dict:
    if key in document:
        document[key] = value
        return document
    if after is None or after not in document:
        document[key] = value
        return document
    rebuilt = {}
    for existing, item in document.items():
        rebuilt[existing] = item
        if existing == after:
            rebuilt[key] = value
    return rebuilt


def theme_names(where: Places) -> list[str]:
    try:
        entries = os.listdir(where.themes)
    except (FileNotFoundError, NotADirectoryError):
        return []
    names = [e[:-5] for e in entries if e.endswith(".json") and is_theme_name(e[:-5])]
    return sorted(n for n in names if (where.themes / f"{n}.json").is_file())


SHORTCUT_MODIFIERS = {
    "cmd": "cmd",
    "command": "cmd",
    "opt": "opt",
    "option": "opt",
    "alt": "opt",
    "ctrl": "ctrl",
    "control": "ctrl",
    "shift": "shift",
    "fn": "fn",
}
SHORTCUT_KEYS = (
    {f"f{n}" for n in range(1, 21)}
    | {"space", "tab", "return", "escape", "delete", "up", "down", "left", "right", "home", "end", "pageup", "pagedown"}
)
SHORTCUT_GLYPHS = "⌘⌥⌃⇧🌐"


def shortcut_problem(value) -> str | None:
    from ardia_cli.schema_check import did_you_mean

    if not isinstance(value, str) or value == "" or any(g in value for g in SHORTCUT_GLYPHS):
        return None
    text = value.strip()
    if text != value:
        return f"{value!r} has spaces around it"
    if text == "+":
        parts = ["+"]
    elif text.endswith("++"):
        parts = text[:-2].split("+") + ["+"]
    else:
        parts = text.split("+")
    *modifiers, key = parts
    seen = set()
    for modifier in modifiers:
        canonical = SHORTCUT_MODIFIERS.get(modifier.lower())
        if canonical is None:
            if not modifier:
                return f"{value!r} has an empty part between + signs"
            return f"{value!r} has an unknown modifier {modifier}{did_you_mean(modifier.lower(), SHORTCUT_MODIFIERS)}"
        if canonical in seen:
            return f"{value!r} repeats {modifier}"
        seen.add(canonical)
    if not key:
        return f"{value!r} ends without a key"
    if len(key) == 1:
        if key.isspace():
            return f"{value!r} uses a space character; write space"
        return None
    if key.lower() in SHORTCUT_KEYS:
        return None
    if key.lower() in SHORTCUT_MODIFIERS:
        return f"{value!r} has no key after its modifiers"
    return f"{value!r} has an unknown key {key}{did_you_mean(key.lower(), sorted(SHORTCUT_KEYS))}"
