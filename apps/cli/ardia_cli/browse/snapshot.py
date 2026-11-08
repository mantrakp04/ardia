import asyncio
from dataclasses import dataclass, field

from ardia_cli.browse.errors import BrowseError
from ardia_cli.browse.state import Ref

INTERACTIVE = {
    "button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox", "listbox", "option", "menuitem",
    "menuitemcheckbox", "menuitemradio", "slider", "spinbutton", "switch", "tab", "treeitem", "Iframe", "iframe",
}
REF_ROLES = INTERACTIVE | {"heading"}
SKIPPED = {"none", "InlineTextBox", "LineBreak", "ListMarker"}
LIFTED = {"generic", "GenericContainer", "group", "Section", "div", "presentation", "RootWebArea", "WebArea", "Ignored", "IgnoredRole"}
MAX_NAME = 200
VALUE_FIELDS = {"Date": "date", "DateTime": "datetime-local", "InputTime": "time", "ColorWell": "color"}
ROLE_NAMES = {"DisclosureTriangle": "button"}
MAX_SCOPES = 20
FIELD_VALUE = "(el) => ({ type: el.type || null, value: 'value' in el ? String(el.value) : null, required: el.required === true })"


@dataclass
class Node:
    role: str
    name: str = ""
    value: str = ""
    props: dict = field(default_factory=dict)
    backend: int | None = None
    children: list = field(default_factory=list)
    ref: str | None = None
    hints: list | None = None
    url: str | None = None
    frame: str | None = None


def _value(item) -> str:
    if not item:
        return ""
    value = item.get("value")
    if value is None:
        return ""
    return str(value)


def clipped(text: str) -> str:
    from ardia_cli.redact import redact

    return redact(text)[:MAX_NAME]


def node_props(raw) -> dict:
    return {prop.get("name"): (prop.get("value") or {}).get("value") for prop in raw.get("properties") or []}


def value_field(raw, role: str) -> Node:
    props = node_props(raw)
    props["inputType"] = VALUE_FIELDS[role]
    return Node("textbox", clipped(_value(raw.get("name")).strip()), clipped(_value(raw.get("value"))), props, raw.get("backendDOMNodeId"))


def build_tree(ax_nodes: list[dict], scope_backend: int | None = None) -> list[Node]:
    by_id = {node["nodeId"]: node for node in ax_nodes}
    roots = [node for node in ax_nodes if not node.get("parentId") or node.get("parentId") not in by_id]
    if scope_backend is not None:
        scoped = [node for node in ax_nodes if node.get("backendDOMNodeId") == scope_backend]
        if not scoped:
            return []
        roots = scoped

    def convert(raw) -> list[Node]:
        role = _value(raw.get("role"))
        if role in VALUE_FIELDS and not raw.get("ignored"):
            return [value_field(raw, role)]
        children = []
        for child_id in raw.get("childIds") or []:
            child = by_id.get(child_id)
            if child is not None:
                children.extend(convert(child))
        if raw.get("ignored") or role in SKIPPED:
            return children
        name = _value(raw.get("name")).strip() if role != "StaticText" else _value(raw.get("name"))
        props = node_props(raw)
        role = ROLE_NAMES.get(role, role)
        node = Node(role, clipped(name), clipped(_value(raw.get("value"))), props, raw.get("backendDOMNodeId"), children)
        if role in LIFTED and not name and scope_backend != raw.get("backendDOMNodeId"):
            node.role = "generic"
        return [node]

    out = []
    for root in roots:
        out.extend(convert(root))
    flat = []
    for node in out:
        if node.role in ("RootWebArea", "WebArea"):
            flat.extend(node.children)
        else:
            flat.append(node)
    return flat


def walk(nodes):
    for node in nodes:
        yield node
        yield from walk(node.children)


def _attrs(node: Node, urls: bool) -> list[str]:
    attrs = []
    props = node.props
    if props.get("inputType"):
        attrs.append(f"type={props['inputType']}")
    if node.role == "heading" and props.get("level") is not None:
        attrs.append(f"level={props['level']}")
    if "checked" in props and node.role in ("checkbox", "radio", "switch", "menuitemcheckbox", "menuitemradio"):
        checked = props["checked"]
        attrs.append(f"checked={'mixed' if checked == 'mixed' else str(checked in (True, 'true')).lower()}")
    if "expanded" in props:
        attrs.append(f"expanded={str(bool(props['expanded'])).lower()}")
    if props.get("selected"):
        attrs.append("selected")
    if "pressed" in props and props["pressed"] not in (None, False, "false"):
        attrs.append("pressed")
    if props.get("disabled"):
        attrs.append("disabled")
    if props.get("required"):
        attrs.append("required")
    if node.ref:
        attrs.append(f"ref={node.ref}")
    if urls and node.url:
        attrs.append(f"url={node.url}")
    return attrs


def _quote(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def _line(node: Node, depth: int, urls: bool) -> str:
    parts = ["  " * depth + "- " + node.role]
    if node.name:
        parts.append(" " + _quote(node.name))
    attrs = _attrs(node, urls)
    if attrs:
        parts.append(" [" + ", ".join(attrs) + "]")
    if node.value and node.value != node.name and node.role not in ("StaticText", "link", "heading"):
        parts.append(": " + node.value.replace("\n", " "))
    if node.hints:
        parts.append(" clickable [" + ", ".join(node.hints) + "]")
    return "".join(parts)


def interactive_rows(nodes: list[Node]) -> list[tuple[int, Node]]:
    rows = []

    def visit(node: Node, level: int):
        if node.ref:
            rows.append((level, node))
            level += 1
        for child in node.children:
            visit(child, level)

    for node in nodes:
        visit(node, 0)
    return rows


def render(nodes: list[Node], interactive: bool = False, compact: bool = False, depth: int | None = None, urls: bool = False) -> str:
    if interactive:
        return "\n".join(_line(node, level, urls) for level, node in interactive_rows(nodes) if depth is None or level <= depth)
    lines = []

    def keep_compact(node: Node) -> bool:
        if node.role == "StaticText":
            return bool(node.name.strip())
        if node.ref or node.name.strip():
            return True
        return any(keep_compact(child) for child in node.children)

    def emit(node: Node, level: int, parent_name: str = ""):
        if node.role == "generic" and not node.name and not node.ref and not node.hints:
            for child in node.children:
                emit(child, level, parent_name)
            return
        if node.role == "StaticText" and parent_name and node.name.strip() == parent_name.strip():
            return
        if compact and not keep_compact(node):
            return
        if node.role == "StaticText" and not node.name.strip():
            return
        if depth is not None and level > depth:
            return
        lines.append(_line(node, level, urls))
        for child in node.children:
            emit(child, level + 1, node.name)

    for node in nodes:
        emit(node, 0)
    return "\n".join(lines)


async def clickable_map(page, frame: str) -> dict[int, list]:
    try:
        remote = await page.call(
            "() => { const r = ardiaBrowse.clickables(); globalThis.ardiaBrowseHints = r.hints; return r.elements; }",
            frame=frame, by_value=False, read=True,
        )
        hints = await page.call("() => globalThis.ardiaBrowseHints", frame=frame, read=True)
        elements = await page.elements_from(remote, frame, "clickable")
    except BrowseError:
        return {}
    return {element.backend_id: hints[index] for index, element in enumerate(elements) if index < len(hints or [])}


async def link_urls(page, nodes: list[Node], frame: str):
    links = [node for node in walk(nodes) if node.role == "link" and node.backend is not None]

    async def fetch(node):
        element = await page.resolve_backend(node.backend, frame, "link")
        if element is not None:
            node.url = await page.call("(el) => el.href || null", element, frame=frame)

    await asyncio.gather(*(fetch(node) for node in links), return_exceptions=True)


async def frame_nodes(page, frame: str, scope_backend: int | None = None, scopes: list[int] | None = None) -> list[Node]:
    params = {"frameId": frame}
    result = await page.send("Accessibility.getFullAXTree", params, timeout=60)
    raw = result.get("nodes") or []
    if scopes is None:
        nodes = build_tree(raw, scope_backend)
    else:
        nodes = []
        seen: set = set()
        for backend in scopes:
            if backend in seen:
                continue
            found = build_tree(raw, backend)
            seen.update(node.backend for node in walk(found))
            nodes.extend(found)
    for node in walk(nodes):
        node.frame = frame
    return nodes


async def scope_elements(state, page, selector: str):
    from ardia_cli.browse.state import parse_ref

    if parse_ref(selector):
        _, element = await state.locate(selector, page)
        return element.frame, [element]
    frame = state.frame_for(page) or page.main_frame
    try:
        remote = await page.call("(s) => ardiaBrowse.queryAll(s)", selector, frame=frame, by_value=False, read=True)
    except BrowseError as error:
        raise BrowseError(f"Invalid selector {selector}: {error.message}") from None
    elements = await page.elements_from(remote, frame, selector, MAX_SCOPES)
    if not elements:
        raise BrowseError(
            f"Element not found: {selector}. Verify the selector, role, or name is correct and the element exists in the DOM.",
            code="not_found",
        )
    return frame, elements


async def field_values(page, nodes: list[Node]):
    fields = [node for node in walk(nodes) if node.props.get("inputType") and node.backend is not None]

    async def fetch(node):
        element = await page.resolve_backend(node.backend, node.frame, "field")
        if element is None:
            return
        found = await page.call(FIELD_VALUE, element, frame=node.frame, read=True)
        if found.get("type"):
            node.props["inputType"] = found["type"]
        if found.get("value") is not None:
            node.value = clipped(found["value"])
        if found.get("required"):
            node.props["required"] = True

    await asyncio.gather(*(fetch(node) for node in fields), return_exceptions=True)


async def collect(state, page, selector=None, cursor=True) -> list[Node]:
    await page.refresh_frames()
    frame = state.frame_for(page) or page.main_frame
    scopes = None
    if selector:
        frame, elements = await scope_elements(state, page, selector)
        scopes = [element.backend_id for element in elements]
    nodes = await frame_nodes(page, frame, scopes=scopes) if scopes else await frame_nodes(page, frame)
    if scopes and not nodes:
        many = f"all {len(scopes)} elements matching it are" if len(scopes) > 1 else "the element matching it is"
        raise BrowseError(f"Nothing in the accessibility tree under {selector}: {many} hidden or empty")
    for node in list(walk(nodes)):
        if node.role in ("Iframe", "iframe") and node.backend is not None:
            try:
                described = await page.send("DOM.describeNode", {"backendNodeId": node.backend})
                child_frame = (described.get("node") or {}).get("frameId")
                if child_frame and child_frame in page.frames and child_frame != frame:
                    node.children = await frame_nodes(page, child_frame)
            except BrowseError:
                pass
    frames_used = {node.frame for node in walk(nodes)}
    clickable = {}
    if cursor:
        for used in frames_used:
            clickable[used] = await clickable_map(page, used)
    for node in walk(nodes):
        hints = clickable.get(node.frame, {}).get(node.backend)
        if hints and node.role not in INTERACTIVE:
            node.hints = hints
            if not node.name:
                element = await page.resolve_backend(node.backend, node.frame, "clickable")
                if element is not None:
                    text = await page.call("(el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim()", element, frame=node.frame)
                    node.name = clipped(text or "")
    await field_values(page, nodes)
    for node in walk(nodes):
        if node.role in REF_ROLES or node.hints:
            if node.role == "heading" and not node.name or node.backend is None:
                continue
            node.ref = state.ref_for_node(page, node.frame, node.backend)
    return nodes


def refs_of(state, page, nodes: list[Node]) -> list[Ref]:
    return [
        Ref(node.ref, state.instance, page.target_id, node.frame, page.loader(node.frame) or "", 0, node.backend, node.role, node.name)
        for node in walk(nodes)
        if node.ref and node.backend is not None
    ]


async def take(state, page, interactive=False, compact=False, depth=None, selector=None, urls=False, cursor=True):
    nodes = await collect(state, page, selector, cursor)
    if urls:
        for used in {node.frame for node in walk(nodes)}:
            await link_urls(page, [node for node in walk(nodes) if node.frame == used], used)
    text = render(nodes, interactive, compact, depth, urls)
    refs = refs_of(state, page, nodes)
    whole = not (depth is not None or selector)
    full_text = text if whole and not (interactive or compact) else None
    state.set_refs(refs, text, page)
    if full_text is not None:
        state.extras["full_snapshot"] = full_text
    if whole:
        from ardia_cli.browse import changes

        changes.note_shown(state, await changes.remember(state, page, nodes))
    return text, refs
