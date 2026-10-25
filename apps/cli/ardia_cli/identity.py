import re

PRODUCT = "Ardia"
COMMAND = "ardia"
BUNDLE_ID = "com.ardia.browser"
RELEASE_REPO = "mantrakp04/ardia"

UPSTREAM_PRODUCT = "Ardia"
UPSTREAM_COMMAND = "ardia"
_ENGINE_NAMES = re.compile(r"`ardia: [^`]*isn't allowed for the ardia command`|\bArdia Scripts\b")
_PRODUCT_WORD = re.compile(r"(?<![\w.$/-])Ardia(?![\w-]|\.(?=\w))")
_COMMAND_WORD = re.compile(r"(?<![\w.$/:-])ardia(?![\w/-]|:/|\.(?=\w))")


def is_upstream() -> bool:
    return PRODUCT == UPSTREAM_PRODUCT and COMMAND == UPSTREAM_COMMAND


def brand(text: str) -> str:
    if is_upstream():
        return text
    kept: list[str] = []

    def keep(match: re.Match) -> str:
        kept.append(match.group(0))
        return f"\0{len(kept) - 1}\0"

    text = _ENGINE_NAMES.sub(keep, text)
    text = _PRODUCT_WORD.sub(PRODUCT.replace("\\", "\\\\"), text)
    text = _COMMAND_WORD.sub(COMMAND.replace("\\", "\\\\"), text)
    return re.sub(r"\0(\d+)\0", lambda match: kept[int(match.group(1))], text)
