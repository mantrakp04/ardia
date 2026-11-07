import datetime
import math
import re

from ardia_cli.browse.errors import BrowseError

SET_DIRECTLY = {"date", "time", "datetime-local", "month", "week", "color", "range"}
FORMATS = {
    "date": "a date input takes YYYY-MM-DD, like 2026-11-09",
    "time": "a time input takes HH:MM in 24-hour time (optionally :SS), like 14:30, or 2:30 PM",
    "datetime-local": "a datetime-local input takes YYYY-MM-DDTHH:MM, like 2026-11-09T14:30",
    "month": "a month input takes YYYY-MM, like 2026-11",
    "week": "a week input takes YYYY-Www, like 2026-W46",
    "color": "a color input takes #rrggbb, like #3b82f6",
    "range": "a range input takes a number, like 50",
}
DATE = re.compile(r"(\d{4,6})-(\d{1,2})-(\d{1,2})")
TIME = re.compile(r"(\d{1,2})(?::(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?\s*([ap]\.?m\.?)?", re.I)
MONTH = re.compile(r"(\d{4,6})-(\d{1,2})")
WEEK = re.compile(r"(\d{4,6})-?[wW](\d{1,2})")
COLOR = re.compile(r"#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})")
SET_VALUE = """(el, value) => {
  const before = el.value;
  el.value = value;
  const stored = el.value;
  const same = el.type === "color" ? stored.toLowerCase() === value.toLowerCase() : stored === value;
  if (!same && el.type !== "range") {
    el.value = before;
    return { set: false, stored };
  }
  el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { set: true, stored: el.value };
}"""


def refuse(kind: str, text: str):
    raise BrowseError(f"{text!r} isn't a {kind} value: {FORMATS[kind]}", data={"type": kind}, code="bad_value")


def date_part(kind: str, text: str, value: str) -> str:
    match = DATE.fullmatch(value)
    if not match:
        refuse(kind, text)
    year, month, day = (int(part) for part in match.groups())
    try:
        datetime.date(year, month, day)
    except ValueError:
        refuse(kind, text)
    return f"{year:04d}-{month:02d}-{day:02d}"


def time_part(kind: str, text: str, value: str) -> str:
    match = TIME.fullmatch(value.strip())
    if not match or (match.group(2) is None and not match.group(5)):
        refuse(kind, text)
    hour, minute, second, fraction, meridiem = match.groups()
    hour, minute = int(hour), int(minute or 0)
    if meridiem:
        if not 1 <= hour <= 12:
            refuse(kind, text)
        hour = hour % 12 + (12 if meridiem.lower().startswith("p") else 0)
    if hour > 23 or minute > 59 or (second is not None and int(second) > 59):
        refuse(kind, text)
    out = f"{hour:02d}:{minute:02d}"
    if second is not None:
        out += f":{int(second):02d}"
        if fraction is not None:
            out += "." + fraction
    return out


def normalize(kind: str, text: str) -> str:
    value = text.strip()
    if value == "":
        return ""
    if kind == "date":
        return date_part(kind, text, value)
    if kind == "time":
        return time_part(kind, text, value)
    if kind == "datetime-local":
        parts = re.split(r"[Tt ]", value, maxsplit=1)
        if len(parts) != 2:
            refuse(kind, text)
        return date_part(kind, text, parts[0]) + "T" + time_part(kind, text, parts[1])
    if kind == "month":
        match = MONTH.fullmatch(value)
        if not match or not 1 <= int(match.group(2)) <= 12:
            refuse(kind, text)
        return f"{int(match.group(1)):04d}-{int(match.group(2)):02d}"
    if kind == "week":
        match = WEEK.fullmatch(value)
        if not match or not 1 <= int(match.group(2)) <= 53:
            refuse(kind, text)
        return f"{int(match.group(1)):04d}-W{int(match.group(2)):02d}"
    if kind == "color":
        match = COLOR.fullmatch(value)
        if not match:
            refuse(kind, text)
        digits = match.group(1).lower()
        return "#" + (digits if len(digits) == 6 else "".join(char * 2 for char in digits))
    if kind == "range":
        try:
            number = float(value)
        except ValueError:
            refuse(kind, text)
        if not math.isfinite(number):
            refuse(kind, text)
        return value
    raise BrowseError(f"{kind} inputs aren't set directly")
