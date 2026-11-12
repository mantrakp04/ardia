import difflib
import math
import re
from dataclasses import dataclass

TYPE_NAMES = {
    "boolean": "true or false",
    "integer": "a whole number",
    "number": "a number",
    "string": "a string",
    "array": "a list",
    "object": "an object",
    "null": "null",
}


@dataclass(frozen=True)
class Problem:
    path: tuple
    message: str

    def to_dict(self) -> dict:
        return {"key": format_path(self.path), "message": self.message}


def format_path(path) -> str:
    text = ""
    for part in path:
        if isinstance(part, int):
            text += f"[{part}]"
        else:
            text += f".{part}" if text else str(part)
    return text


def json_type(value) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def has_type(value, name: str) -> bool:
    actual = json_type(value)
    if name == "number":
        return actual in ("integer", "number")
    if name == "integer":
        return actual == "integer" or (actual == "number" and math.isfinite(value) and value == int(value))
    return actual == name


def json_equal(left, right) -> bool:
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return left == right
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(json_equal(a, b) for a, b in zip(left, right))
    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(json_equal(left[k], right[k]) for k in left)
    return type(left) is type(right) and left == right


def show(value) -> str:
    import json

    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)


def choices(values) -> str:
    shown = [show(v) for v in values]
    if len(shown) == 1:
        return shown[0]
    return ", ".join(shown[:-1]) + " or " + shown[-1]


def ecma_pattern(pattern: str):
    out = []
    escaped = False
    in_class = False
    for char in pattern:
        if escaped:
            out.append(char)
            escaped = False
        elif char == "\\":
            out.append(char)
            escaped = True
        elif in_class:
            out.append(char)
            if char == "]":
                in_class = False
        elif char == "[":
            out.append(char)
            in_class = True
        elif char == "$":
            out.append(r"\Z")
        else:
            out.append(char)
    return re.compile("".join(out), re.ASCII)


def closest(name: str, candidates) -> list[str]:
    candidates = [c for c in candidates if isinstance(c, str)]
    folded = [c for c in candidates if c.lower() == name.lower()]
    return folded or difflib.get_close_matches(name, candidates, n=3, cutoff=0.6)


def did_you_mean(name: str, candidates) -> str:
    found = closest(name, candidates)
    return f" (did you mean {choices(found)}?)" if found else ""


def describe(schema) -> str:
    if schema is True or not isinstance(schema, dict):
        return "anything"
    if "const" in schema:
        return show(schema["const"])
    if "enum" in schema:
        return choices(schema["enum"])
    if "anyOf" in schema:
        return " or ".join(describe(s) for s in schema["anyOf"])
    kinds = schema.get("type")
    names = [kinds] if isinstance(kinds, str) else list(kinds or [])
    if not names:
        return "anything"
    parts = []
    for name in names:
        if name == "array":
            items = schema.get("items")
            prefix = schema.get("prefixItems")
            fixed = items is False or schema.get("maxItems") == len(prefix or [])
            if isinstance(prefix, list) and prefix and fixed:
                parts.append(f"a list of {len(prefix)} ({', '.join(describe(p) for p in prefix)})")
            elif isinstance(items, dict):
                parts.append(f"a list of {plural(describe(items))}")
            else:
                parts.append("a list")
        elif name in ("number", "integer"):
            parts.append(TYPE_NAMES[name] + bounds(schema))
        else:
            parts.append(TYPE_NAMES.get(name, name))
    return " or ".join(parts)


def plural(text: str) -> str:
    for article in ("a ", "an "):
        if text.startswith(article):
            rest = text[len(article):]
            if rest.startswith("list"):
                return "lists" + rest[4:]
            if rest.startswith("whole number"):
                return "whole numbers" + rest[12:]
            word, _, tail = rest.partition(" ")
            return f"{word}s{' ' + tail if tail else ''}"
    return text


def bounds(schema) -> str:
    parts = []
    if is_number(schema.get("minimum")):
        parts.append(f"at least {show(schema['minimum'])}")
    if is_number(schema.get("exclusiveMinimum")):
        parts.append(f"more than {show(schema['exclusiveMinimum'])}")
    if is_number(schema.get("maximum")):
        parts.append(f"at most {show(schema['maximum'])}")
    return f" {' and '.join(parts)}" if parts else ""


def is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate(value, schema, path=(), root=True, noun=None) -> list[Problem]:
    if schema is True or schema is None:
        return []
    if schema is False:
        return [Problem(path, f"{format_path(path) or 'the file'} isn't allowed")]
    if not isinstance(schema, dict):
        return []
    name = format_path(path) or "the file"
    kinds = schema.get("type")
    if kinds is not None:
        names = [kinds] if isinstance(kinds, str) else list(kinds)
        if not any(has_type(value, k) for k in names):
            return [Problem(path, f"{name} must be {describe(schema)}")]
    if "const" in schema and not json_equal(value, schema["const"]):
        return [Problem(path, f"{name} must be {show(schema['const'])}")]
    if "enum" in schema and not any(json_equal(value, option) for option in schema["enum"]):
        return [Problem(path, f"{name} must be {choices(schema['enum'])}")]
    if "anyOf" in schema:
        problem = check_any_of(value, schema["anyOf"], path, name)
        if problem:
            return problem
    problems = []
    if is_number(value):
        problems += check_bounds(value, schema, path, name)
    if isinstance(value, str) and isinstance(schema.get("pattern"), str):
        if not ecma_pattern(schema["pattern"]).search(value):
            problems.append(Problem(path, f"{name} must match {schema['pattern']}"))
    if isinstance(value, list):
        problems += check_array(value, schema, path, name)
    if isinstance(value, dict):
        problems += check_object(value, schema, path, name, root, noun)
    return problems


def check_bounds(value, schema, path, name) -> list[Problem]:
    if is_number(schema.get("minimum")) and value < schema["minimum"]:
        return [Problem(path, f"{name} must be at least {show(schema['minimum'])}")]
    if is_number(schema.get("exclusiveMinimum")) and value <= schema["exclusiveMinimum"]:
        return [Problem(path, f"{name} must be more than {show(schema['exclusiveMinimum'])}")]
    if is_number(schema.get("maximum")) and value > schema["maximum"]:
        return [Problem(path, f"{name} must be at most {show(schema['maximum'])}")]
    return []


def check_any_of(value, branches, path, name) -> list[Problem]:
    if not isinstance(branches, list) or not branches:
        return []
    results = [validate(value, branch, path, False) for branch in branches]
    if any(not result for result in results):
        return []
    typed = [r for b, r in zip(branches, results) if not type_mismatch(value, b)]
    if len(typed) == 1:
        return typed[0]
    return [Problem(path, f"{name} must be {' or '.join(describe(b) for b in branches)}")]


def type_mismatch(value, schema) -> bool:
    if not isinstance(schema, dict):
        return False
    kinds = schema.get("type")
    if kinds is not None:
        names = [kinds] if isinstance(kinds, str) else list(kinds)
        if not any(has_type(value, k) for k in names):
            return True
    if "const" in schema and json_type(schema["const"]) != json_type(value) and not (is_number(value) and is_number(schema["const"])):
        return True
    if "enum" in schema and not any(json_type(o) == json_type(value) or (is_number(o) and is_number(value)) for o in schema["enum"]):
        return True
    return False


def check_array(value, schema, path, name) -> list[Problem]:
    problems = []
    if isinstance(schema.get("minItems"), int) and len(value) < schema["minItems"]:
        problems.append(Problem(path, f"{name} must have at least {schema['minItems']} item{'s' if schema['minItems'] != 1 else ''}"))
    if isinstance(schema.get("maxItems"), int) and len(value) > schema["maxItems"]:
        problems.append(Problem(path, f"{name} must have at most {schema['maxItems']} item{'s' if schema['maxItems'] != 1 else ''}"))
    prefix = schema.get("prefixItems") if isinstance(schema.get("prefixItems"), list) else []
    for index, item in enumerate(value):
        if index < len(prefix):
            problems += validate(item, prefix[index], path + (index,), False)
        elif "items" in schema:
            if schema["items"] is False:
                message = f"{name} must have at most {len(prefix)} item{'s' if len(prefix) != 1 else ''}"
                if not any(p.message == message for p in problems):
                    problems.append(Problem(path, message))
                break
            problems += validate(item, schema["items"], path + (index,), False)
    return problems


def check_object(value, schema, path, name, root, noun) -> list[Problem]:
    problems = []
    properties = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
    required = schema.get("required") if isinstance(schema.get("required"), list) else []
    for key in required:
        if key not in value:
            problems.append(Problem(path, f"{name} needs {key}"))
    names = schema.get("propertyNames")
    extra = schema.get("additionalProperties", True)
    for key, item in value.items():
        if names is not None and names is not True:
            if validate(key, names, (), False):
                allowed = names.get("enum", []) if isinstance(names, dict) else []
                problems.append(Problem(path + (key,), f"{unknown(key, path, noun)}{did_you_mean(key, allowed)}"))
                continue
        if key in properties:
            problems += validate(item, properties[key], path + (key,), False)
        elif root and key == "$schema":
            continue
        elif extra is False:
            problems.append(Problem(path + (key,), f"{unknown(key, path, noun)}{did_you_mean(key, properties)}"))
        elif isinstance(extra, dict):
            problems += validate(item, extra, path + (key,), False)
    return problems


def unknown(key: str, path, noun=None) -> str:
    where = format_path(path)
    if noun and not where:
        return f"unknown {noun} {key}"
    return f"unknown key {key} in {where}" if where else f"unknown key {key}"
