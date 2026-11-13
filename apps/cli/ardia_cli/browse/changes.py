import asyncio
import re
import shlex
from dataclasses import dataclass, field
from urllib.parse import parse_qsl, unquote, urlsplit

from ardia_cli import command_metrics
from ardia_cli.browse import snapshot
from ardia_cli.redact import redact
from ardia_cli.browse.errors import BrowseError, CdpError, ConnectionLost, Gated

SETTLE_LIMIT = 1.5
FIRST_QUIET = 0.05
QUIET = 0.12
POLL = 0.025
STOP_TIMEOUT = 2.0
READ_METHODS = {"GET", "HEAD", "OPTIONS"}
LONG_LIVED = {"EventSource", "WebSocket"}
MAX_ADDED = 40
MAX_NAVIGATED = 150
COLLAPSE_RUN = 6
COLLAPSE_LONG_RUN = 12
RUN_LABEL = 40
COLLAPSED_ROLES = {"option": COLLAPSE_RUN, "link": COLLAPSE_RUN, "menuitem": COLLAPSE_RUN, "menuitemradio": COLLAPSE_RUN,
                   "menuitemcheckbox": COLLAPSE_RUN, "treeitem": COLLAPSE_RUN, "generic": COLLAPSE_RUN, "button": COLLAPSE_LONG_RUN,
                   "radio": COLLAPSE_LONG_RUN, "checkbox": COLLAPSE_LONG_RUN, "switch": COLLAPSE_LONG_RUN, "tab": COLLAPSE_LONG_RUN}
KEPT_STATES = {"selected", "pressed", "expanded=true"}
RUN_HINT = "(a run of the same role is one line; `snapshot -i` lists each, `find role <role> <action> --name <text>` acts on one)"
MAX_REMOVED_LINES = 5
MAX_REMOVED_REFS = 30
MAX_WRITES = 20
MAX_PATH = 200
WATCH_BUFFER = 1024 * 1024
SAFE_KEY = re.compile(r"[A-Za-z0-9_.\[\]-]{1,40}")
SENSITIVE_KEY = re.compile(r"code|token|pass|pwd|secret|key|sig|auth|session|cred|otp|state|nonce|ticket|jwt", re.I)
OPENED_TEXT = 1200
NAVIGATED_TEXT = 3000
NAVIGATED_REPORT = 5400
MIN_NAVIGATED_LIST = 1200
OPENED_LEVEL = 2
CONTAINER_ROLES = {"dialog", "alertdialog", "article", "region"}
MAX_TEXT_MARKS = 200
MIN_NEW_TEXT = 40
MIN_FRAME_TEXT = 200
MARKER = re.compile("\x01(\\d+)\x01")
INLINE_REF = re.compile(r" \[@(e\d+)\]")
TEXT_JS = r"""(budget, ...anchors) => {
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "SVG", "svg"]);
  const BLOCK = /^(P|DIV|SECTION|ARTICLE|MAIN|HEADER|FOOTER|NAV|ASIDE|FORM|FIELDSET|UL|OL|LI|TABLE|THEAD|TBODY|TFOOT|TR|BLOCKQUOTE|PRE|FIGURE|FIGCAPTION|DETAILS|SUMMARY|DL|DT|DD|ADDRESS|HR|BR|DIALOG|H[1-6])$/;
  const CONTAINER = "article,dialog,[role=dialog],[role=alertdialog],[role=region],section,main > *";
  const CONTROL = "a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=option],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=switch],[role=combobox],[role=textbox],[role=searchbox],[role=slider],[role=spinbutton],[role=treeitem],[contenteditable=''],[contenteditable=true]";
  const NESTED = "h1,h2,h3,h4,h5,h6,[role=heading],li,pre,iframe,tr,dialog,[role=dialog]";
  const SEP = "\u0002", CELL = "\u0003";
  const norm = (text) => String(text || "").replace(/\s+/g, " ").trim();
  const quote = (text) => JSON.stringify(norm(text).slice(0, 80));
  const els = [], kinds = [], names = [];
  const mark = (el, kind, name) => { els.push(el); kinds.push(kind); names.push(name || ""); return "\u0001" + (els.length - 1) + "\u0001"; };
  const close = (el) => { line = line.replace(/[\s\u0002]+$/, "") + mark(el, "ref"); };
  const isHeading = (el) => /^H[1-6]$/.test(el.tagName) || el.getAttribute("role") === "heading";
  let roots = anchors.length ? anchors.map((anchor) => {
    const from = isHeading(anchor) ? anchor.parentElement : anchor;
    return (from && from.closest(CONTAINER)) || from || anchor;
  }) : [document.querySelector("main,[role=main]") || document.body];
  roots = roots.filter((root, index) => root && roots.indexOf(root) === index);
  roots = roots.filter((root) => !roots.some((other) => other !== root && other.contains(root)));
  roots.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const lines = [];
  let line = "", size = 0, full = false;
  const tidy = (text) => text.replace(/[\s\u0002]*\u0003[\s\u0002]*/g, "\u0003").replace(/\u0003/g, " | ").replace(/[\s\u0002]*\u0002[\s\u0002]*/g, " · ")
    .replace(/\s+/g, " ").trim().replace(/^(· |\| )+/, "").replace(/^- (· )+/, "- ").replace(/( ·| \|)+$/, "").trim();
  const flush = () => {
    let text = tidy(line);
    line = "";
    if (!text || /^[-#]+$/.test(text) || full) return;
    if (size + text.length > budget) { text = text.slice(0, Math.max(0, budget - size)) + "…"; full = true; }
    lines.push(text);
    size += text.length + 1;
    if (size >= budget) full = true;
  };
  const hidden = (el, style) => style.display === "none" || style.visibility === "hidden" || el.getAttribute("aria-hidden") === "true";
  const compact = (el) => el.textContent.length <= 500 && norm(el.innerText).length <= 200 && !el.querySelector(NESTED);
  const field = (el) => {
    const type = (el.type || "").toLowerCase();
    if (el.tagName === "SELECT") return norm(el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].text : "");
    if (type === "checkbox" || type === "radio") return el.checked ? "[x]" : "[ ]";
    if (type === "password") return el.value ? "••••" : "";
    if (["button", "submit", "reset"].includes(type)) return norm(el.value);
    if (el.value) return quote(el.value);
    return el.placeholder ? "(" + norm(el.placeholder).slice(0, 60) + ")" : "";
  };
  const pointer = (el, style) => style.cursor === "pointer" && !(el.parentElement && getComputedStyle(el.parentElement).cursor === "pointer");
  const children = (el, oneLine) => {
    for (const child of el.childNodes) walk(child, oneLine);
    if (el.shadowRoot) for (const child of el.shadowRoot.childNodes) walk(child, oneLine);
  };
  const walk = (node, oneLine) => {
    if (full) return;
    if (node.nodeType === 3) { line += node.nodeValue; return; }
    if (node.nodeType !== 1 || SKIP.has(node.tagName)) return;
    const el = node, tag = el.tagName.toUpperCase();
    const style = getComputedStyle(el);
    if (hidden(el, style)) return;
    if (tag === "IFRAME" || tag === "FRAME") {
      flush();
      line = "[frame " + quote(el.title || el.name || (el.src || "").split(/[?#]/)[0].split("/").pop()) + mark(el, "frame") + "]";
      flush();
      return;
    }
    const role = el.getAttribute("role");
    if (tag === "CANVAS" || tag === "IMG" || (role === "img" && !norm(el.textContent))) {
      const label = norm(el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("title"));
      const box = el.getBoundingClientRect();
      if (box.width < 48 || box.height < 48) { if (label) line += " " + label + " "; return; }
      line += " [image " + quote(label) + mark(el, "image", label) + "] ";
      return;
    }
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
      if ((el.type || "").toLowerCase() === "hidden") return;
      line += " " + field(el) + (el.disabled ? "" : mark(el, "ref")) + " ";
      return;
    }
    const off = el.disabled === true || el.getAttribute("aria-disabled") === "true";
    const control = el.matches(CONTROL) || pointer(el, style);
    const candidate = control && !off;
    const label = control ? norm(el.getAttribute("aria-label")) : "";
    if (label && norm(el.innerText).length <= 80) {
      if (off) { line += " " + (norm(el.innerText) || "×") + " "; return; }
      line += " " + label;
      close(el);
      line += " ";
      return;
    }
    if (isHeading(el)) {
      flush();
      const level = /^H([1-6])$/.exec(tag) ? Number(tag[1]) : Number(el.getAttribute("aria-level")) || 2;
      line = "#".repeat(level) + " ";
      children(el, true);
      close(el);
      flush();
      return;
    }
    const display = style.display;
    const block = BLOCK.test(tag) || !(display.startsWith("inline") || display === "contents");
    if (!block) {
      children(el, oneLine);
      if (candidate) close(el);
      return;
    }
    if (oneLine) {
      const cell = tag === "TD" || tag === "TH" || display === "table-cell";
      line += cell ? (el.previousElementSibling ? CELL : "") : SEP;
      children(el, true);
      if (candidate) close(el);
      if (!cell) line += SEP;
      return;
    }
    flush();
    if (tag === "LI") line = "- ";
    children(el, compact(el));
    if (candidate) close(el);
    flush();
  };
  for (const root of roots) { walk(root, false); flush(); }
  globalThis.ardiaBrowseTextEls = els;
  const where = (el) => {
    if (el.id) return "#" + CSS.escape(el.id);
    const tag = el.tagName.toLowerCase(), role = el.getAttribute("role");
    if (document.querySelectorAll(tag).length === 1) return tag;
    if (role && document.querySelectorAll("[role=" + JSON.stringify(role) + "]").length === 1) return "[role=" + role + "]";
    const parent = el.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) return tag;
    const same = [...parent.children].filter((child) => child.tagName === el.tagName);
    return where(parent) + " > " + tag + (same.length > 1 ? ":nth-of-type(" + (same.indexOf(el) + 1) + ")" : "");
  };
  return { text: lines.join("\n"), kinds, names, more: full, where: roots.length ? where(roots[0]) : "" };
}"""


@dataclass
class View:
    target: str
    loader: str
    url: str
    title: str
    entries: list = field(default_factory=list)
    containers: frozenset = frozenset()


def entry(level: int, node) -> dict:
    attrs = [attr for attr in snapshot._attrs(node, False) if not attr.startswith("ref=")]
    return {"ref": node.ref, "level": level, "role": node.role, "name": node.name, "value": node.value, "attrs": attrs,
            "line": snapshot._line(node, 0, False)[2:]}


def entries_of(nodes) -> list[dict]:
    return [entry(level, node) for level, node in snapshot.interactive_rows(nodes)]


def containers_of(nodes) -> frozenset:
    return frozenset((node.frame, node.backend) for node in snapshot.walk(nodes) if node.role in CONTAINER_ROLES and node.backend is not None)


def view_frame(state, page) -> str:
    return state.frame_for(page) or page.main_frame


async def title_of(page) -> str:
    try:
        title = await page.call("() => document.title", frame=page.main_frame, read=True)
    except ConnectionLost:
        raise
    except BrowseError:
        return ""
    return title if isinstance(title, str) else ""


async def view(state, page, nodes=None) -> View:
    if nodes is None:
        nodes = await snapshot.collect(state, page)
    return View(page.target_id, page.loader(view_frame(state, page)) or "", page.url, await title_of(page), entries_of(nodes),
                containers_of(nodes))


async def remember(state, page, nodes) -> View:
    seen = await view(state, page, nodes)
    state.extras.setdefault("views", {})[page.target_id] = seen
    return seen


def mark_shown(state, report: dict, after: View):
    shown = state.extras.setdefault("shown", {})
    report["back"] = [row["ref"] for row in report["added"] if shown.get(row["ref"]) == row["line"]]
    shown.update((row["ref"], row["line"]) for row in after.entries)


def note_shown(state, seen: View):
    state.extras.setdefault("shown", {}).update((row["ref"], row["line"]) for row in seen.entries)


def previous(state, page) -> View | None:
    seen = state.extras.get("views", {}).get(page.target_id)
    if seen is None or seen.loader != (page.loader(view_frame(state, page)) or ""):
        return None
    return seen


def key(row: dict) -> tuple:
    return row["role"], row["name"], row["value"], tuple(row["attrs"])


def public(row: dict) -> dict:
    return {name: row[name] for name in ("ref", "role", "name", "value", "attrs")}


def diff(before: View | None, after: View, writes: list | None = None) -> dict:
    new_document = before is None or before.loader != after.loader
    old = {} if new_document else {row["ref"]: row for row in before.entries}
    now = {row["ref"]: row for row in after.entries}
    added = [row for row in after.entries if row["ref"] not in old]
    removed = [] if new_document else [row for row in before.entries if row["ref"] not in now]
    changed = [(old[row["ref"]], row) for row in after.entries if row["ref"] in old and key(old[row["ref"]]) != key(row)]
    return {
        "rerendered": rerendered(added, removed),
        "document": "new" if new_document else "same",
        "url": {"from": before.url, "to": after.url} if before is not None and before.url != after.url else None,
        "title": {"from": before.title, "to": after.title} if before is not None and before.title != after.title else None,
        "added": added,
        "removed": removed,
        "changed": changed,
        "network": list(writes or []),
        "context": after.entries,
    }


def rerendered(added: list[dict], removed: list[dict]) -> list[tuple[dict, dict]]:
    waiting: dict[tuple, list[dict]] = {}
    for row in removed:
        waiting.setdefault((row["level"], *key(row)), []).append(row)
    pairs = []
    for row in added:
        same = waiting.get((row["level"], *key(row)))
        if same:
            pairs.append((same.pop(0), row))
    return pairs


def refs_text(refs: list[str]) -> str:
    numbers = [int(ref[1:]) for ref in refs if ref[1:].isdigit()]
    if len(numbers) == len(refs) and len(refs) > 2 and numbers == list(range(numbers[0], numbers[0] + len(numbers))):
        return f"{refs[0]}…{refs[-1]}"
    more = f" … {len(refs) - MAX_REMOVED_REFS} more" if len(refs) > MAX_REMOVED_REFS else ""
    return " ".join(refs[:MAX_REMOVED_REFS]) + more


def was(old: dict, new: dict) -> str:
    if old["value"] != new["value"]:
        return f" (was {old['value']!r})" if old["value"] else " (was empty)"
    if old["name"] != new["name"]:
        return f" (was named {old['name']!r})"
    if old["attrs"] != new["attrs"]:
        return f" (was [{', '.join(old['attrs'])}])" if old["attrs"] else " (was plain)"
    return ""


def network_line(write: dict) -> str:
    statuses = " → ".join(str(status) for status in write.get("statuses") or [])
    outcome = write.get("failed") or statuses or "pending"
    return f"{write['method']} {write['url']} → {outcome}"


def plural(role: str, count: int) -> str:
    if count == 1:
        return role
    return role + ("es" if role.endswith(("x", "s", "ch")) else "s")


def kept_whole(row: dict) -> bool:
    return any(attr in KEPT_STATES or attr.startswith("checked=true") or attr == "checked=mixed" for attr in row["attrs"])


def item_runs(rows: list[dict], parents: dict[str, dict] | None = None) -> list:
    out = []
    index = 0
    while index < len(rows):
        row = rows[index]
        items = [(index, row)]
        end = index + 1
        while end < len(rows):
            other = rows[end]
            if other["level"] > row["level"]:
                end += 1
                continue
            if other["level"] == row["level"] and other["role"] == row["role"]:
                items.append((end, other))
                end += 1
                continue
            break
        if len(items) >= COLLAPSED_ROLES.get(row["role"], len(items) + 1):
            out.append(("run", rows[index:end], [item for _, item in items], (parents or {}).get(row["ref"])))
            index = end
        else:
            out.append(("row", row))
            index += 1
    return out


def run_label(text: str) -> str:
    text = " ".join(redact(str(text or "")).split())
    return text if len(text) <= RUN_LABEL else text[: RUN_LABEL - 1] + "…"


def run_text(items: list[dict], parent: dict | None, verb: str = "") -> str:
    role = items[0]["role"]
    where = f" in {parent['role']} {snapshot._quote(run_label(parent['name']))}" if parent and parent.get("name") else ""
    names = [run_label(item["name"] or item["value"]) for item in items]
    span = f"{names[0]} … {names[-1]}" if names[0] or names[-1] else ""
    refs = f"{items[0]['ref']}…{items[-1]['ref']}"
    disabled = sum(1 for item in items if "disabled" in item["attrs"])
    extra = f"; {disabled} disabled" if disabled else ""
    detail = "; ".join(part for part in (span, refs) if part)
    return f"{len(items)} {plural(role, len(items))}{where}{verb} ({detail}{extra})"


def parents_of(rows: list[dict]) -> dict[str, dict]:
    stack: list[dict] = []
    out = {}
    for row in rows:
        while stack and stack[-1]["level"] >= row["level"]:
            stack.pop()
        if stack:
            out[row["ref"]] = stack[-1]
        stack.append(row)
    return out


def added_lines(added: list[dict], parents: dict[str, dict]) -> list[str]:
    base = min(row["level"] for row in added)
    lines = []

    def indent(row):
        return "  " * (row["level"] - base)

    for part in item_runs(added, parents):
        if part[0] == "row":
            lines.append("+ " + indent(part[1]) + part[1]["line"])
            continue
        _, rows, items, parent = part
        off = [item for item in items if "disabled" in item["attrs"]]
        on = [item for item in items if "disabled" not in item["attrs"]]
        if off and on:
            lines.extend(choices_lines(on, off, indent(items[0])))
            continue
        lines.append("+ " + indent(items[0]) + run_text(items, parent))
        lines.extend("+ " + indent(row) + row["line"] for row in rows if kept_whole(row))
    return lines


def choices_lines(on: list[dict], off: list[dict], indent: str) -> list[str]:
    command_metrics.flag("change_run_choices", True)
    role = on[0]["role"]
    lines = ["+ " + indent + row["line"] for row in on[:MAX_ADDED]]
    if len(on) > MAX_ADDED:
        lines.append(f"+ {indent}… {len(on) - MAX_ADDED} more enabled {plural(role, len(on) - MAX_ADDED)} (`snapshot -i` lists every one)")
    span = f"{run_label(off[0]['name'] or off[0]['value'])} … {run_label(off[-1]['name'] or off[-1]['value'])}" if len(off) > 1 else run_label(off[0]["name"])
    lines.append(f"+ {indent}{len(off)} disabled {plural(role, len(off))} ({span})")
    return lines


def plain_row(row: dict) -> bool:
    return not row["value"] and all(attr.startswith("level=") for attr in row["attrs"])


def text_block(text: dict) -> list[str]:
    lines = ["text:"] + ["  " + line for line in text["lines"]]
    if text.get("more"):
        lines.append(f"  … more: read -s {shlex.quote(text['where'])}" if text.get("where") else "  … more: read")
    return lines


def within(lines: list[str], budget: int) -> int:
    used = 0
    for index, line in enumerate(lines):
        used += len(line) + 1
        if used > budget:
            return index
    return len(lines)


def changed_lines(changed: list[tuple[dict, dict]], parents: dict[str, dict]) -> list[str]:
    news = [new for _, new in changed]
    olds = {new["ref"]: old for old, new in changed}
    lines = []
    for part in item_runs(news, parents):
        if part[0] == "row":
            lines.append(f"~ {part[1]['line']}{was(olds[part[1]['ref']], part[1])}")
            continue
        _, rows, items, parent = part
        lines.append("~ " + run_text(items, parent, " changed"))
        lines.extend(f"~ {row['line']}{was(olds[row['ref']], row)}" for row in rows if kept_whole(row) and not kept_whole(olds[row["ref"]]))
    return lines


def render(report: dict, before_known: bool = True) -> str:
    lines = []
    if report["url"]:
        lines.append(f"url: {masked_url(report['url']['from'])} → {masked_url(report['url']['to'])}")
    if report["title"]:
        lines.append(f"title: {report['title']['from']!r} → {report['title']['to']!r}")
    back = set(report.get("back") or [])
    again = report.get("rerendered") or []
    fresh = {new["ref"] for _, new in again}
    text = report.get("text")
    inline = set(text["refs"]) if text else set()
    added = [row for row in report["added"] if row["ref"] not in back and row["ref"] not in fresh
             and not (row["ref"] in inline and plain_row(row))]
    parents = parents_of(report.get("context") or report["added"] + [new for _, new in report["changed"]])
    navigated = moved(report)
    if report.get("notes"):
        lines.append(report["notes"])
    if report["document"] == "new" and before_known:
        where = "; the ones marked [@e…] in its text below aren't repeated here" if text and len(added) < len(report["added"]) else ""
        lines.append(f"new document, {len(report['added'])} interactive nodes (its snapshot -i, so no need to take one{where}):")
    if back:
        refs = [row["ref"] for row in report["added"] if row["ref"] in back]
        more = f" … {len(refs) - MAX_REMOVED_REFS} more" if len(refs) > MAX_REMOVED_REFS else ""
        lines.append(f"+ {len(refs)} back as last shown: {' '.join(refs[:MAX_REMOVED_REFS])}{more}")
    if added:
        shown = added_lines(added, parents)
        limit = MAX_NAVIGATED if navigated else MAX_ADDED
        if navigated and text:
            budget = max(MIN_NAVIGATED_LIST, NAVIGATED_REPORT - sum(len(line) + 1 for line in text_block(text)))
            limit = min(limit, within(shown, budget))
        lines.extend(shown[:limit])
        if len(shown) > limit:
            lines.append(f"+ … {len(shown) - limit} more lines (`snapshot -i -s <css>` shows one region)")
    if again:
        lines.append(f"+ {len(again)} redrawn as they were, with new refs: {refs_text([new['ref'] for _, new in again])}")
    if text:
        lines.extend(text_block(text))
    lines.extend(changed_lines(report["changed"], parents))
    gone = {old["ref"] for old, _ in again}
    removed = [row for row in report["removed"] if row["ref"] not in gone]
    if len(removed) <= MAX_REMOVED_LINES:
        lines.extend(f"- {row['line']}" for row in removed)
    elif navigated and text:
        lines.append(f"- {len(removed)} of the last view's nodes removed")
    else:
        refs = " ".join(row["ref"] for row in removed[:MAX_REMOVED_REFS])
        more = f" … {len(removed) - MAX_REMOVED_REFS} more" if len(removed) > MAX_REMOVED_REFS else ""
        lines.append(f"- {len(removed)} removed: {refs}{more}")
    writes = report["network"]
    lines.extend(network_line(write) for write in writes[:MAX_WRITES])
    if len(writes) > MAX_WRITES:
        lines.append(f"… {len(writes) - MAX_WRITES} more requests (`network requests`)")
    if report.get("unsettled"):
        lines.append("(the page was still busy after 1.5 s; snapshot again for the final state)")
    if report.get("error"):
        lines.append(f"(couldn't read the page afterwards: {report['error']})")
    if any(part[0] == "run" for rows in (added, [new for _, new in report["changed"]]) for part in item_runs(rows)):
        lines.append(RUN_HINT)
    return "changes:\n" + "\n".join(lines) if lines else "changes: none"


def as_data(report: dict) -> dict:
    data = {
        "document": report["document"],
        "url": {"from": masked_url(report["url"]["from"]), "to": masked_url(report["url"]["to"])} if report["url"] else None,
        "title": report["title"],
        "added": [public(row) for row in report["added"]],
        "removed": [public(row) for row in report["removed"]],
        "changed": [{"ref": new["ref"], "from": public(old), "to": public(new)} for old, new in report["changed"]],
        "network": report["network"],
        "back": list(report.get("back") or []),
        "rerendered": [{"ref": new["ref"], "was": old["ref"]} for old, new in report.get("rerendered") or []],
    }
    if report.get("notes"):
        data["notes"] = report["notes"]
    if report.get("text"):
        data["text"] = {"lines": report["text"]["lines"], "more": bool(report["text"].get("more")), "where": report["text"].get("where") or None}
    if report.get("unsettled"):
        data["unsettled"] = True
    if report.get("error"):
        data["error"] = report["error"]
    return data


def clean_url(url: str) -> str:
    url = redact(url)
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return "(unparseable URL)"
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https", "ws", "wss"):
        return f"{scheme}:…" if scheme else "(no URL)"
    host = parts.hostname or ""
    if ":" in host:
        host = f"[{host}]"
    netloc = host + (f":{port}" if port is not None else "")
    path = "/".join("…" if secret_like(segment) else segment for segment in (parts.path or "/").split("/"))
    if len(path) > MAX_PATH:
        path = path[:MAX_PATH] + "…"
    keys = [(name if SAFE_KEY.fullmatch(name) else "…") + ("=…" if value else "") for name, value in parse_qsl(parts.query, keep_blank_values=True)]
    return f"{scheme}://{netloc}{path}" + ("?" + "&".join(keys) if keys else "")


def secret_like(segment: str) -> bool:
    if ":" in segment or "%3a" in segment.lower():
        return True
    return len(segment) >= 20 and bool(re.search(r"\d", segment)) and bool(re.search(r"[A-Za-z]", segment))


def masked_pair(part: str) -> str:
    name, sep, value = part.partition("=")
    if sep and value and SENSITIVE_KEY.search(unquote(name)):
        return f"{name}=…"
    return part


def masked_url(url: str) -> str:
    url = redact(url)
    try:
        parts = urlsplit(url)
    except ValueError:
        return "(unparseable URL)"
    if parts.scheme.lower() not in ("http", "https"):
        return url if not parts.query and not parts.fragment else f"{parts.scheme}:…"
    netloc = parts.hostname or ""
    if ":" in netloc:
        netloc = f"[{netloc}]"
    if parts.port is not None:
        netloc += f":{parts.port}"
    query = "&".join(masked_pair(part) for part in parts.query.split("&") if part)
    fragment = "…" if "=" in parts.fragment else parts.fragment
    return f"{parts.scheme}://{netloc}{parts.path}" + (f"?{query}" if query else "") + (f"#{fragment}" if fragment else "")


class NetworkWatch:
    def __init__(self, page):
        self.page = page
        self.enabled_here = False
        self.watching = False
        self.records: dict[str, dict] = {}
        self.order: list[str] = []
        self.last_event = 0.0

    def listener(self, event_page, method, params):
        if event_page is not self.page or not method.startswith("Network."):
            return
        request_id = params.get("requestId")
        if not request_id:
            return
        loop = asyncio.get_running_loop()
        self.last_event = loop.time()
        if method == "Network.requestWillBeSent":
            record = self.records.get(request_id)
            request = params.get("request") or {}
            if record is None:
                record = self.records[request_id] = {
                    "method": str(request.get("method") or "GET").upper(),
                    "url": clean_url(str(request.get("url") or "")),
                    "type": params.get("type") or "Other",
                    "statuses": [],
                    "done": False,
                }
                self.order.append(request_id)
            redirect = params.get("redirectResponse")
            if redirect and redirect.get("status") is not None:
                record["statuses"].append(redirect["status"])
        elif request_id in self.records:
            record = self.records[request_id]
            if method == "Network.responseReceived":
                status = (params.get("response") or {}).get("status")
                if status is not None:
                    record["statuses"].append(status)
                record["answered"] = True
            elif method == "Network.loadingFinished":
                record["done"] = True
            elif method == "Network.loadingFailed":
                record["done"] = True
                record["failed"] = "canceled" if params.get("canceled") else str(params.get("errorText") or "failed")[:200]

    async def start(self):
        self.page.state.listeners.append(self.listener)
        self.watching = True
        self.last_event = asyncio.get_running_loop().time()
        if self.page.network_on:
            return
        self.enabled_here = True
        try:
            await self.page.send("Network.enable", {"maxTotalBufferSize": WATCH_BUFFER, "maxResourceBufferSize": WATCH_BUFFER})
        except BrowseError as error:
            if isinstance(error, (CdpError, Gated)):
                self.enabled_here = False
            await self.stop()
            if isinstance(error, ConnectionLost):
                raise
        except BaseException:
            await self.stop()
            raise

    def busy(self) -> bool:
        return any(not record["done"] and not record.get("answered") and record["type"] not in LONG_LIVED for record in self.records.values())

    async def settle(self, page_busy=None) -> bool:
        loop = asyncio.get_running_loop()
        started = loop.time()
        deadline = started + SETTLE_LIMIT
        while True:
            now = loop.time()
            quiet = QUIET if self.records else FIRST_QUIET
            waiting = self.watching and (self.busy() or now - max(self.last_event, started) < quiet)
            if not waiting and page_busy is not None:
                waiting = await page_busy()
            if not waiting:
                return True
            if now >= deadline:
                return False
            await asyncio.sleep(POLL)

    async def stop(self):
        if self.listener in self.page.state.listeners:
            self.page.state.listeners.remove(self.listener)
        self.watching = False
        if not self.enabled_here:
            return
        self.enabled_here = False
        if self.page.network_on or self.page.session_id is None:
            return
        cleanup = asyncio.ensure_future(self.disable(self.page.session_id))
        cancelled = False
        while not cleanup.done():
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError:
                cancelled = True
        if cancelled:
            raise asyncio.CancelledError

    async def disable(self, session: str):
        try:
            await asyncio.wait_for(self.page.send("Network.disable"), STOP_TIMEOUT)
            return
        except Exception:
            pass
        if self.page.session_id != session:
            return
        self.page.detach()
        try:
            await asyncio.wait_for(self.page.browser.send("Target.detachFromTarget", {"sessionId": session}), STOP_TIMEOUT)
        except Exception:
            pass

    def writes(self) -> list[dict]:
        rows = []
        for request_id in self.order:
            record = self.records[request_id]
            if record["method"] in READ_METHODS:
                continue
            row = {"method": record["method"], "url": record["url"], "type": record["type"], "statuses": list(record["statuses"])}
            row["status"] = record["statuses"][-1] if record["statuses"] else None
            if record.get("failed"):
                row["failed"] = record["failed"]
            elif not record["done"] and not record.get("answered"):
                row["pending"] = True
            rows.append(row)
        return rows


async def navigation_busy(page, navigations: int):
    if page.navigations == navigations:
        return False
    current = page.lifecycle.get(page.main_frame)
    return not (current and current[0] == page.loader(page.main_frame) and "DOMContentLoaded" in current[1])


async def observe(ctx, page, run):
    if ctx.options.get("no_changes"):
        return await run(), None
    state = ctx.state
    try:
        before = await view(state, page)
    except ConnectionLost:
        raise
    except BrowseError:
        before = None
    watch = NetworkWatch(page)
    navigations = page.navigations
    try:
        await watch.start()
        value = await run()
        settling = command_metrics.clock()
        settled = await watch.settle(lambda: navigation_busy(page, navigations))
        command_metrics.spent("settle_ms", settling)
    finally:
        await watch.stop()
    try:
        await page.refresh_frames()
        nodes = await snapshot.collect(state, page)
        state.set_refs(snapshot.refs_of(state, page, nodes), None, page)
        after = await remember(state, page, nodes)
    except ConnectionLost:
        raise
    except BrowseError as error:
        report = diff(None, View(page.target_id, "", page.url, ""), watch.writes())
        report["document"] = "unknown"
        report["error"] = error.message
        return value, report
    report = diff(before, after, watch.writes())
    report["notes"] = arrival_notes(state, before, after) if report["document"] == "new" else None
    mark_shown(state, report, after)
    if not settled:
        report["unsettled"] = True
    if before is None:
        report["document"] = "unknown"
    await add_text(ctx, page, nodes, report, before)
    return value, report


async def settled(page, run):
    watch = NetworkWatch(page)
    navigations = page.navigations
    try:
        await watch.start()
        value = await run()
        settling = command_metrics.clock()
        await watch.settle(lambda: navigation_busy(page, navigations))
        command_metrics.spent("settle_ms", settling)
    finally:
        await watch.stop()
    return value


async def arrival(ctx, page, came_from: str):
    state = ctx.state
    try:
        await page.refresh_frames()
        nodes = await snapshot.collect(state, page)
        state.set_refs(snapshot.refs_of(state, page, nodes), None, page)
        after = await remember(state, page, nodes)
    except ConnectionLost:
        raise
    except BrowseError:
        return None
    report = diff(None, after)
    report["notes"] = arrival_notes(state, View(page.target_id, "", came_from, ""), after)
    mark_shown(state, report, after)
    await add_text(ctx, page, nodes, report, None)
    command_metrics.flag("open_report", True)
    return report


def moved(report: dict) -> bool:
    return report["document"] == "new" or bool(report["url"]) or bool(report["title"])


def fresh_rows(report: dict) -> list[dict]:
    back = set(report.get("back") or [])
    redrawn = {new["ref"] for _, new in report.get("rerendered") or []}
    return [row for row in report["added"] if row["ref"] not in back and row["ref"] not in redrawn]


def heading_level(node) -> int:
    try:
        return int(node.props.get("level") or 0)
    except (TypeError, ValueError):
        return 0


def opened_anchors(report: dict, nodes, before: View | None) -> list:
    fresh = {row["ref"] for row in fresh_rows(report)}
    known = before.containers if before is not None else frozenset()
    anchors = []
    for node in snapshot.walk(nodes):
        if node.backend is None:
            continue
        if node.role == "heading" and node.ref in fresh and 0 < heading_level(node) <= OPENED_LEVEL:
            anchors.append(node)
        elif node.role in CONTAINER_ROLES and (node.frame, node.backend) not in known and any(
                inner.ref in fresh for inner in snapshot.walk(node.children)):
            anchors.append(node)
    return anchors


def adds_text(lines: list[str], rows: list[dict]) -> bool:
    rest = INLINE_REF.sub("", "\n".join(lines))
    for row in rows:
        if len(row["name"]) >= 3:
            rest = rest.replace(row["name"], "", 1)
    return len(re.sub(r"[\W_]+", "", rest)) >= MIN_NEW_TEXT


async def add_text(ctx, page, nodes, report: dict, before: View | None):
    if ctx.options.get("no_text") or report["document"] == "unknown":
        return
    frame = view_frame(ctx.state, page)
    if moved(report):
        anchors, budget = [], NAVIGATED_TEXT
    else:
        anchors, budget = [node for node in opened_anchors(report, nodes, before) if node.frame == frame], OPENED_TEXT
        if not anchors:
            return
    refs = {(node.frame, node.backend): node.ref for node in snapshot.walk(nodes) if node.ref and node.backend is not None}
    try:
        text = await page_text(ctx.state, page, frame, budget, anchors, refs)
    except ConnectionLost:
        raise
    except BrowseError:
        return
    if text is None or not adds_text(text["lines"], fresh_rows(report)):
        return
    report["text"] = text
    command_metrics.flag("change_text", True)
    command_metrics.count("change_text_chars", sum(len(line) + 1 for line in text["lines"]))


async def page_text(state, page, frame: str, budget: int, anchors: list, refs: dict, nested: bool = False) -> dict | None:
    elements = []
    for node in anchors:
        element = await page.resolve_backend(node.backend, node.frame, "opened content")
        if element is not None:
            elements.append(element)
    if anchors and not elements:
        return None
    found = await page.call(TEXT_JS, budget, *elements, frame=frame, read=True)
    if not isinstance(found, dict) or not found.get("text"):
        return None
    kinds = found.get("kinds") or []
    names = found.get("names") or []
    marked = []
    if kinds:
        remote = await page.call("() => globalThis.ardiaBrowseTextEls", frame=frame, by_value=False, read=True)
        marked = await page.elements_from(remote, frame, "text", MAX_TEXT_MARKS)
    inline: set[str] = set()
    inner: dict[int, str] = {}

    def replace(match) -> str:
        index = int(match.group(1))
        if index >= len(marked) or index >= len(kinds):
            return ""
        element, kind = marked[index], kinds[index]
        ref = refs.get((frame, element.backend_id))
        if kind == "image":
            return f": screenshot @{ref or state.add_ref(page, element, 'image', names[index])}"
        if kind == "frame":
            ref = ref or state.add_ref(page, element, "Iframe", names[index])
            inner[index] = ref
            inline.add(ref)
            return f": frame @{ref}; read"
        if not ref:
            return ""
        inline.add(ref)
        return f" [@{ref}]"

    lines = []
    frames_at = []
    for raw in found["text"].split("\n"):
        indexes = [int(index) for index in MARKER.findall(raw)]
        line = re.sub(r" {2,}", " ", redact(MARKER.sub(replace, raw).replace("\x01", ""))).strip()
        if line:
            lines.append(line)
            frames_at.extend((len(lines), index) for index in indexes if index in inner)
    more = bool(found.get("more"))
    left = budget - sum(len(line) + 1 for line in lines)
    for at, index in reversed(frames_at if not nested else []):
        child = await frame_of(page, marked[index])
        if child is None or left < MIN_FRAME_TEXT:
            continue
        sub_text = await page_text(state, page, child, left, [], refs, True)
        if sub_text:
            lines[at:at] = sub_text["lines"]
            inline |= sub_text["refs"]
            more = more or sub_text["more"]
            left -= sum(len(line) + 1 for line in sub_text["lines"])
    if not lines:
        return None
    return {"lines": lines, "refs": inline, "more": more, "where": found.get("where") or ""}


async def frame_of(page, element) -> str | None:
    try:
        described = await page.send("DOM.describeNode", {"backendNodeId": element.backend_id})
    except BrowseError:
        return None
    child = (described.get("node") or {}).get("frameId")
    return child if child and child in page.frames else None


def arrival_notes(state, before: View | None, after: View) -> str | None:
    from pathlib import Path

    from ardia_cli import notes

    root = state.config.get("data_root") if isinstance(getattr(state, "config", None), dict) else None
    if not root or (before is not None and notes.page_site(before.url) == notes.page_site(after.url)):
        return None
    return notes.header(Path(root), after.url)[1]


def attach(result, report):
    if report is None:
        return result
    result.data["changes"] = as_data(report)
    if report.get("text"):
        result.page_content = True
    text = render(report, report["document"] != "unknown")
    if report["document"] == "unknown" and report["added"]:
        text = text.replace("changes:\n", "changes (no view of the page before, so everything shows as added):\n", 1)
    result.text = (result.text if result.text is not None else "✓ Done") + "\n" + text
    return result
