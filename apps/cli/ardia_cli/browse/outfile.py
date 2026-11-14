import io
import json
import sys
from contextlib import redirect_stdout
from pathlib import Path

from ardia_cli.browse.errors import Usage

TAKES_OUT = ("script", "eval", "read", "snapshot", "get")
AS_TEXT = ("snapshot", "get")
PREVIEW = 300
EXCERPT = 240
EXCERPT_PAGES = 12
LOG_LINES = 20


def take_out(argv: list[str], command: str | None) -> tuple[list[str], str | None]:
    if command not in TAKES_OUT or command not in argv:
        return argv, None
    start = argv.index(command) + 1
    for index in range(start, len(argv)):
        token = argv[index]
        if token == "--":
            break
        if token.startswith("--out="):
            return argv[:index] + argv[index + 1:], checked(token.split("=", 1)[1])
        if token == "--out":
            if index + 1 >= len(argv):
                raise Usage(f"--out takes a file path: {command} … --out data.json")
            return argv[:index] + argv[index + 2:], checked(argv[index + 1])
    return argv, None


def checked(path: str) -> str:
    if not path or path.startswith("-"):
        raise Usage("--out takes a file path, like --out data.json")
    return path


def run_saving(run, argv: list[str], command: str, path: str) -> int:
    from ardia_cli import telemetry

    captured = io.StringIO()
    if command in AS_TEXT:
        with redirect_stdout(captured):
            code = run([*argv, "--max-output", "0"])
        if code:
            sys.stdout.write(captured.getvalue())
            return code
        text = captured.getvalue()
        target = save(path, text)
        telemetry.note_count("saved_to_file", True)
        lines = text.splitlines()
        sys.stdout.write(f"✓ Saved to {target} ({len(text):,} characters, {len(lines):,} lines). First lines:\n" + "\n".join(lines[:12]) + "\n")
        return code
    with redirect_stdout(captured):
        code = run(["--json", *argv])
    try:
        payload = json.loads(captured.getvalue())
    except ValueError:
        sys.stdout.write(captured.getvalue())
        return code
    if not isinstance(payload, dict) or not payload.get("success"):
        message = payload.get("error") if isinstance(payload, dict) else None
        sys.stderr.write(f"✗ {message or 'the command failed'}\n")
        return code or 1
    data = payload.get("data") or {}
    text, summary = content(command, data, Path(path))
    target = save(path, text)
    telemetry.note_count("saved_to_file", True)
    sys.stdout.write(f"✓ Saved to {target} ({len(text):,} characters): {summary}\n")
    logs = [str(line) for line in (data.get("logs") or [])][-LOG_LINES:]
    if logs:
        sys.stdout.write("logged:\n" + "\n".join(logs) + "\n")
    return code


def save(path: str, text: str) -> Path:
    from ardia_cli.redact import redact

    target = Path(path).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.part")
    temporary.write_text(redact(text), encoding="utf-8")
    temporary.replace(target)
    return target


def list_digest(items: list) -> str:
    head = f"a list of {len(items)} item{'s' if len(items) != 1 else ''}"
    if not items:
        return head
    keys = sorted({key for item in items[:50] if isinstance(item, dict) for key in item})
    lines = [head + (f" with fields {', '.join(keys[:20])}" if keys else "")]
    lines.append(f"first: {json.dumps(items[0], ensure_ascii=False)[:PREVIEW]}")
    if len(items) > 1:
        lines.append(f"last: {json.dumps(items[-1], ensure_ascii=False)[:PREVIEW]}")
    return "\n".join(lines)


def content(command: str, data: dict, path: Path) -> tuple[str, str]:
    if command == "read" and "rows" in data:
        rows = data.get("rows") or []
        text = json.dumps(rows, ensure_ascii=False, indent=2) if path.suffix.lower() == ".json" else "\n".join(map(str, rows)) + "\n"
        return text, f"{list_digest(rows)}\n(stopped: {data.get('stopped')}; {data.get('total')} rows in the list)"
    if command == "read":
        pages = data.get("pages") or []
        failed = sum(1 for page in pages if page.get("error"))
        lines = [f"{len(pages)} page{'s' if len(pages) != 1 else ''}{f', {failed} failed' if failed else ''}:"]
        for page in pages[:EXCERPT_PAGES]:
            facts = ", ".join(str(fact) for fact in (f"HTTP {page['status']}" if page.get("status") else None, page.get("readAt")) if fact)
            head = f"- {(page.get('title') or '(no title)')[:80]}{f' ({facts})' if facts else ''} {page.get('finalUrl') or page.get('url') or ''}"
            body = page.get("error") or " ".join((page.get("text") or "").split())[:EXCERPT]
            lines.append(f"{head}\n  {body}{' …' if not page.get('error') and len(page.get('text') or '') > EXCERPT else ''}")
            if page.get("note"):
                lines.append(f"  ({page['note']})")
        if len(pages) > EXCERPT_PAGES:
            lines.append(f"- and {len(pages) - EXCERPT_PAGES} more pages in the file")
        summary = "\n".join(lines)
        if path.suffix.lower() == ".json":
            return json.dumps(pages, ensure_ascii=False, indent=2), summary
        blocks = [f"=== {page.get('title') or '(no title)'}\n{page.get('finalUrl') or page.get('url') or ''}\n\n{page.get('text') or page.get('error') or ''}"
                  for page in pages]
        return "\n".join(blocks) + "\n", summary
    value = data.get("value") if command == "script" else data.get("result")
    if isinstance(value, str):
        return value, f"text starting {json.dumps(value[:PREVIEW], ensure_ascii=False)}"
    text = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    if isinstance(value, list):
        return text, list_digest(value)
    if isinstance(value, dict):
        keys = list(value)
        parts = [f"{key} ({len(value[key])} items)" if isinstance(value[key], list) else str(key) for key in keys[:20]]
        digest = f"an object with {len(keys)} key{'s' if len(keys) != 1 else ''}: {', '.join(parts)}{', …' if len(keys) > 20 else ''}"
        lists = [key for key in keys if isinstance(value[key], list) and value[key]]
        if lists:
            digest += f"\n{lists[0]}: {list_digest(value[lists[0]])}"
        return text, digest
    if value is None:
        return text, "nothing (the result was undefined or null)"
    return text, f"the value {text.strip()[:PREVIEW]}"
