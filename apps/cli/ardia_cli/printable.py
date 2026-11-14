import re
import sys
from contextlib import contextmanager

FIELD_CONTROLS = re.compile(r"[\x00-\x1f\x7f-\x9f]")
TEXT_CONTROLS = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]")
JSON_CONTROLS = re.compile(r"[\x7f-\x9f]")


def _escaped(found) -> str:
    return f"\\u{ord(found.group()):04x}"


def shown(value) -> str:
    text = "" if value is None else str(value)
    return FIELD_CONTROLS.sub(_escaped, text)


def inert(text: str) -> str:
    return TEXT_CONTROLS.sub(_escaped, text)


def json_safe(text: str) -> str:
    return JSON_CONTROLS.sub(_escaped, text)


class InertStream:
    def __init__(self, stream, clean=inert):
        self._stream = stream
        self._clean = clean

    def write(self, text):
        return self._stream.write(self._clean(text) if isinstance(text, str) else text)

    def writelines(self, lines):
        for line in lines:
            self.write(line)

    def __getattr__(self, name):
        return getattr(self._stream, name)


def say(text: str) -> None:
    sys.stdout.write(text + "\n")
    sys.stdout.flush()


def complain(text: str) -> None:
    sys.stdout.flush()
    sys.stderr.write(text + "\n")
    sys.stderr.flush()


def json_requested(argv: list[str]) -> bool:
    head = argv[:argv.index("--")] if "--" in argv else argv
    return "--json" in head


@contextmanager
def inert_output(json_stdout: bool):
    saved = sys.stdout, sys.stderr
    if not isinstance(sys.stdout, InertStream):
        sys.stdout = InertStream(sys.stdout, json_safe if json_stdout else inert)
    if not isinstance(sys.stderr, InertStream):
        sys.stderr = InertStream(sys.stderr)
    try:
        yield
    finally:
        sys.stdout, sys.stderr = saved
