import re

CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f]")


def shown(value) -> str:
    text = "" if value is None else str(value)
    return CONTROL.sub(lambda found: f"\\x{ord(found.group()):02x}", text)
