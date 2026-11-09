#!/usr/bin/env python3
import html
import json
import re
import sys
import threading
from datetime import datetime
from pathlib import Path
from urllib.parse import quote, urlencode

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from benchhttp import Handler, now_ms, serve_forever

DOCS_PORT, REVIEW_PORT = 8801, 8802
HERE = Path(__file__).resolve().parent
CONTENT = HERE / "content"
VERSIONS = ("v3", "v2")
LATEST = "v3"
PER_PAGE = 10
API_HOST = "https://api.halyard.dev"

EXPECTED = {
    "vendor": "halyard",
    "api_version": "v3",
    "team_rate_limit": 2000,
    "webhook_payload_kb": 256,
    "webhook_signature": "hmacsha256",
    "enterprise_audit_days": 365,
    "offsets_sunset": "2027-04-30",
}
SIGNATURES = ("none", "hmac-sha1", "hmac-sha256", "ed25519", "mtls")
LOCK = threading.Lock()
STATE = {}


def reset_state():
    with LOCK:
        STATE.update(submissions=[], rejected=0, errors_shown=0, reset_at_ms=now_ms())


def esc(s):
    return html.escape(str(s), quote=True)


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def inline(s):
    parts = re.split(r"(`[^`]+`)", s)
    out = []
    for p in parts:
        if p.startswith("`") and p.endswith("`") and len(p) > 1:
            out.append(f"<code>{esc(p[1:-1])}</code>")
            continue
        p = esc(p)
        p = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", p)
        p = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", r'<a href="\2">\1</a>', p)
        out.append(p)
    return "".join(out)


def render_md(md):
    lines, out, toc, i = md.strip("\n").split("\n"), [], [], 0
    block_start = re.compile(r"^(```|#{2,3} |\||> |- |\d+\. )")
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
        elif line.startswith("```"):
            lang, buf, i = line[3:].strip() or "text", [], i + 1
            while i < len(lines) and not lines[i].startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            out.append(f'<div class="code-block"><div class="code-head"><span>{esc(lang)}</span>'
                       f'<button type="button" class="copy">Copy</button></div><pre><code>{esc(chr(10).join(buf))}</code></pre></div>')
        elif re.match(r"^#{2,3} ", line):
            level = 2 if line.startswith("## ") else 3
            text = line[level + 1:].strip()
            anchor = slugify(text)
            if level == 2:
                toc.append((anchor, text))
            out.append(f'<h{level} id="{anchor}">{inline(text)}<a class="anchor" href="#{anchor}" aria-label="Link to this section">#</a></h{level}>')
            i += 1
        elif line.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
                    rows.append(cells)
                i += 1
            head = "".join(f"<th scope=\"col\">{inline(c)}</th>" for c in rows[0])
            body = "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in rows[1:])
            out.append(f'<div class="table-wrap"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>')
        elif line.startswith("> "):
            buf = []
            while i < len(lines) and lines[i].startswith("> "):
                buf.append(lines[i][2:])
                i += 1
            text = " ".join(buf)
            kind = "warning" if re.match(r"\*\*(Warning|Deprecated|Important)", text) else "note"
            out.append(f'<div class="callout {kind}" role="note"><p>{inline(text)}</p></div>')
        elif line.startswith("- ") or re.match(r"^\d+\. ", line):
            ordered = not line.startswith("- ")
            items = []
            while i < len(lines) and (lines[i].startswith("- ") if not ordered else re.match(r"^\d+\. ", lines[i])):
                items.append(re.sub(r"^(- |\d+\. )", "", lines[i]))
                i += 1
            tag = "ol" if ordered else "ul"
            out.append(f"<{tag}>" + "".join(f"<li>{inline(t)}</li>" for t in items) + f"</{tag}>")
        else:
            buf = []
            while i < len(lines) and lines[i].strip() and not block_start.match(lines[i]):
                buf.append(lines[i])
                i += 1
            out.append(f"<p>{inline(' '.join(buf))}</p>")
    return "\n".join(out), toc


def endpoint_md(v, ep):
    md = [ep["summary"], "", "```http", f"{ep['method']} {API_HOST}{ep['path']}", "```"]
    if ep.get("notice"):
        md += ["", "> " + ep["notice"]]
    for label, key in (("Path parameters", "path_params"), ("Query parameters", "query"), ("Request body", "body")):
        if ep.get(key):
            md += ["", f"## {label}", "", "| Name | Type | Required | Description |", "| --- | --- | --- | --- |"]
            md += [f"| `{n}` | {t} | {'Yes' if r else 'No'} | {d} |" for n, t, r, d in ep[key]]
    if ep.get("example"):
        md += ["", "## Example request", "", "```bash", ep["example"], "```"]
    md += ["", "## Response", "", ep.get("response_text", "Returns the resource on success."), "", "```json",
           json.dumps(ep["response"], indent=2), "```"]
    md += ["", "## Errors", "", "| Status | Code | Meaning |", "| --- | --- | --- |"]
    md += [f"| {s} | `{c}` | {m} |" for s, c, m in ep.get("errors", [])]
    md += ["| 401 | `unauthenticated` | The API key is missing, malformed or revoked. |",
           f"| 429 | `rate_limited` | You exceeded your plan's rate limit. Back off and retry after the `Retry-After` header. See [Rate limits](/{v}/platform/rate-limits). |"]
    return "\n".join(md)


def load_version(v):
    folder = CONTENT / v
    nav = json.loads((folder / "nav.json").read_text())
    raw = (folder / "pages.txt").read_text()
    bodies = {}
    for chunk in re.split(r"^@@ ", raw, flags=re.M)[1:]:
        slug, _, body = chunk.partition("\n")
        bodies[slug.strip()] = body
    for group in json.loads((folder / "api.json").read_text()):
        for ep in group["endpoints"]:
            bodies[ep["slug"]] = endpoint_md(v, ep)
    pages, order = {}, []

    def walk(items, trail):
        for item in items:
            if "items" in item:
                walk(item["items"], trail + [item["group"]])
            else:
                order.append(item["slug"])
                pages[item["slug"]] = {"slug": item["slug"], "title": item["title"], "trail": trail,
                                       "updated": item.get("updated", "2026-10-01"), "md": bodies[item["slug"]]}

    for section in nav:
        walk(section["items"], [section["section"]])
    for idx, slug in enumerate(order):
        page = pages[slug]
        page["html"], page["toc"] = render_md(page["md"])
        page["prev"] = order[idx - 1] if idx > 0 else None
        page["next"] = order[idx + 1] if idx + 1 < len(order) else None
        text = re.sub(r"<[^>]+>", " ", page["html"])
        page["text"] = re.sub(r"\s+", " ", html.unescape(text.replace("#</a>", "</a>"))).strip()
        page["headings"] = " ".join(t for _, t in page["toc"])
    return {"nav": nav, "pages": pages, "order": order}


DOCS = {v: load_version(v) for v in VERSIONS}


def nav_html(v, current):
    pages = DOCS[v]["pages"]

    def contains(items):
        return any(contains(i["items"]) if "items" in i else i["slug"] == current for i in items)

    def items_html(items):
        out = []
        for item in items:
            if "items" in item:
                opened = " open" if contains(item["items"]) else ""
                out.append(f'<li><details{opened}><summary>{esc(item["group"])}</summary><ul>{items_html(item["items"])}</ul></details></li>')
            else:
                cur = ' aria-current="page" class="active"' if item["slug"] == current else ""
                out.append(f'<li><a href="/{v}/{item["slug"]}"{cur}>{esc(pages[item["slug"]]["title"])}</a></li>')
        return "".join(out)

    return "".join(f'<div class="nav-section"><h2>{esc(s["section"])}</h2><ul>{items_html(s["items"])}</ul></div>' for s in DOCS[v]["nav"])


def layout(title, v, body, current=None, q=""):
    other = [x for x in VERSIONS if x != v]
    switch_links = "".join(
        f'<li><a href="/{x}/{current if current and current in DOCS[x]["pages"] else ""}"'
        f'{" aria-current=\"true\"" if x == v else ""}>{x}{" (latest)" if x == LATEST else " (maintenance)"}</a></li>'
        for x in VERSIONS)
    banner = ""
    if v != LATEST:
        target = f"/{LATEST}/{current}" if current and current in DOCS[LATEST]["pages"] else f"/{LATEST}/"
        banner = (f'<div class="version-banner" role="note">You are reading the documentation for Halyard API {v}, which is in maintenance mode. '
                  f'<a href="{target}">View the latest version ({LATEST})</a>.</div>')
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)} | Halyard Docs</title>
<link rel="stylesheet" href="/assets/docs.css">
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header class="topbar">
  <a class="brand" href="/{v}/"><span class="mark" aria-hidden="true">H</span>Halyard <span class="muted">Docs</span></a>
  <details class="version-menu"><summary aria-label="API version">API {v}</summary><ul>{switch_links}</ul></details>
  <form class="search" action="/search" method="get" role="search">
    <input type="search" name="q" value="{esc(q)}" placeholder="Search docs" aria-label="Search docs" autocomplete="off">
    <kbd aria-hidden="true">/</kbd>
  </form>
  <nav class="toplinks" aria-label="Site"><a href="/{v}/reference/overview">API reference</a><a href="/{v}/resources/changelog">Changelog</a><a href="/{v}/resources/support">Support</a></nav>
</header>
{banner}
<div class="frame">
  <nav class="sidebar" aria-label="Documentation">{nav_html(v, current)}</nav>
  {body}
</div>
<script src="/assets/docs.js"></script>
</body>
</html>"""


def fmt_date(iso):
    d = datetime.strptime(iso, "%Y-%m-%d")
    return f"{d.strftime('%B')} {d.day}, {d.year}"


def page_html(v, slug):
    page = DOCS[v]["pages"][slug]
    pages = DOCS[v]["pages"]
    crumbs = [f'<li><a href="/{v}/">Docs</a></li>'] + [f"<li>{esc(t)}</li>" for t in page["trail"]] + [f'<li aria-current="page">{esc(page["title"])}</li>']
    pn = []
    if page["prev"]:
        pn.append(f'<a class="prev" href="/{v}/{page["prev"]}" rel="prev"><span>Previous</span>{esc(pages[page["prev"]]["title"])}</a>')
    if page["next"]:
        pn.append(f'<a class="next" href="/{v}/{page["next"]}" rel="next"><span>Next</span>{esc(pages[page["next"]]["title"])}</a>')
    toc = "".join(f'<li><a href="#{a}">{esc(t)}</a></li>' for a, t in page["toc"])
    toc_html = f'<nav class="toc" aria-label="On this page"><h2>On this page</h2><ul>{toc}</ul></nav>' if toc else ""
    body = f"""<main id="content" class="content">
  <nav aria-label="Breadcrumb"><ol class="crumbs">{''.join(crumbs)}</ol></nav>
  <article class="doc"><h1>{esc(page['title'])}</h1>{page['html']}</article>
  <p class="updated">Last updated {fmt_date(page['updated'])}</p>
  <nav class="pager" aria-label="Pages">{''.join(pn)}</nav>
</main>
{toc_html}"""
    return layout(page["title"], v, body, slug)


def terms_of(q):
    return [t for t in re.findall(r"[a-z0-9]+", q.lower()) if len(t) > 1 or t.isdigit()]


def stem(t):
    return t[:-1] if len(t) > 3 and t.endswith("s") else t


def search(q, version):
    terms = [stem(t) for t in terms_of(q)]
    if not terms:
        return []
    hits = []
    for v in VERSIONS:
        for page in DOCS[v]["pages"].values():
            title, heads, text = page["title"].lower(), page["headings"].lower(), page["text"].lower()
            counts = [(title.count(t), heads.count(t), text.count(t)) for t in terms]
            coverage = sum(1 for c in counts if sum(c))
            if not coverage:
                continue
            score = sum(8 * a + 3 * b + min(c, 12) for a, b, c in counts) * (1.1 if v == LATEST else 1.0)
            hits.append((coverage, score, v, page))
    hits.sort(key=lambda h: (-h[0], -h[1], h[2] != LATEST, h[3]["title"]))
    return [(v, page) for _, _, v, page in hits if version in ("", v)]


def snippet(text, terms):
    low = text.lower()
    pos = min([p for p in (low.find(t) for t in terms) if p >= 0] or [0])
    start = max(0, pos - 90)
    piece = text[start:start + 240]
    piece = ("…" if start else "") + piece + ("…" if start + 240 < len(text) else "")
    out = esc(piece)
    for t in sorted(set(terms), key=len, reverse=True):
        out = re.sub(f"({re.escape(esc(t))})", r"<mark>\1</mark>", out, flags=re.I)
    return out


def search_html(q, version, page_no):
    terms = [stem(t) for t in terms_of(q)]
    all_hits = search(q, "")
    hits = [h for h in all_hits if version in ("", h[0])]
    pages = max(1, (len(hits) + PER_PAGE - 1) // PER_PAGE)
    page_no = min(max(1, page_no), pages)
    shown = hits[(page_no - 1) * PER_PAGE: page_no * PER_PAGE]

    def link(**kw):
        params = {"q": q, "v": version, "page": page_no}
        params.update(kw)
        return "/search?" + urlencode({k: val for k, val in params.items() if val not in ("", None, 1) or k == "q"})

    filters = "".join(
        f'<a href="{link(v=val, page=1)}"{" aria-current=\"true\" class=\"on\"" if version == val else ""}>{label} '
        f'<span class="n">{sum(1 for h in all_hits if val in ("", h[0]))}</span></a>'
        for val, label in (("", "All versions"), ("v3", "v3"), ("v2", "v2")))
    items = "".join(
        f'<li><a href="/{v}/{p["slug"]}"><span class="badge {v}">{v}</span> {esc(p["title"])}</a>'
        f'<div class="path">{" › ".join(esc(t) for t in p["trail"])}</div>'
        f'<p>{snippet(p["text"], terms)}</p></li>' for v, p in shown)
    pager = ""
    if pages > 1:
        nums = "".join(f'<a href="{link(page=n)}"{" aria-current=\"page\" class=\"on\"" if n == page_no else ""}>{n}</a>' for n in range(1, pages + 1))
        prev = f'<a href="{link(page=page_no - 1)}" rel="prev">Previous</a>' if page_no > 1 else '<span class="disabled">Previous</span>'
        nxt = f'<a href="{link(page=page_no + 1)}" rel="next">Next</a>' if page_no < pages else '<span class="disabled">Next</span>'
        pager = f'<nav class="search-pager" aria-label="Search results pages">{prev}{nums}{nxt}</nav>'
    if not q.strip():
        summary = "<p>Type a word or phrase to search the documentation.</p>"
    elif not hits:
        summary = f"<p>No results for <strong>{esc(q)}</strong>. Try fewer or different words.</p>"
    else:
        first = (page_no - 1) * PER_PAGE + 1
        summary = f'<p class="count">Showing {first}–{first + len(shown) - 1} of {len(hits)} results for <strong>{esc(q)}</strong></p>'
    body = f"""<main id="content" class="content search-page">
  <h1>Search</h1>
  <form class="search-big" action="/search" method="get" role="search">
    <label for="q-big" class="sr">Search docs</label>
    <input id="q-big" type="search" name="q" value="{esc(q)}">
    <input type="hidden" name="v" value="{esc(version)}">
    <button type="submit">Search</button>
  </form>
  <div class="filters" role="group" aria-label="Version">{filters}</div>
  {summary}
  <ol class="results">{items}</ol>
  {pager}
</main>"""
    return layout(f"Search: {q}" if q else "Search", LATEST if version != "v2" else "v2", body, None, q)


def to_number(raw):
    s = str(raw or "").strip().lower().replace(",", "").replace("_", "").replace(" ", " ")
    m = re.fullmatch(r"(\d+(?:\.\d+)?|\.\d+)\s*([a-z/ .]*)", s)
    return (float(m.group(1)), m.group(2).strip().rstrip(".")) if m else (None, None)


def parse_rate(raw):
    n, unit = to_number(raw)
    if n is None or unit not in ("", "rpm", "/min", "per min", "per minute", "req/min", "requests/min", "requests/minute", "requests per minute", "req per minute", "requests / minute"):
        return None
    return n


def parse_kb(raw):
    n, unit = to_number(raw)
    factors = {"": 1, "kb": 1, "kib": 1, "k": 1, "mb": 1024, "mib": 1024, "b": 1 / 1024, "bytes": 1 / 1024}
    return None if n is None or unit not in factors else n * factors[unit]


def parse_days(raw):
    n, unit = to_number(raw)
    factors = {"": 1, "d": 1, "day": 1, "days": 1, "year": 365, "years": 365, "yr": 365}
    return None if n is None or unit not in factors else n * factors[unit]


def parse_date(raw):
    s = re.sub(r"\s+", " ", str(raw or "").strip().replace(",", ""))
    for f in ("%Y-%m-%d", "%m/%d/%Y", "%B %d %Y", "%b %d %Y", "%d %B %Y", "%d %b %Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, f).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return None


def validate(form):
    errors, vals = {}, {}
    vals["vendor"] = str(form.get("vendor", "")).strip()
    if not vals["vendor"]:
        errors["vendor"] = "Enter the vendor's name."
    vals["api_version"] = str(form.get("api_version", "")).strip()
    if vals["api_version"] not in ("v1", "v2", "v3"):
        errors["api_version"] = "Choose the API version you reviewed."
    for field, parser, message in (
        ("team_rate_limit", parse_rate, "Enter the limit as a number of requests per minute, for example 750."),
        ("webhook_payload_kb", parse_kb, "Enter the size in KB, for example 128."),
        ("enterprise_audit_days", parse_days, "Enter the retention as a number of days, for example 90."),
    ):
        value = parser(form.get(field))
        if value is None or value <= 0:
            errors[field] = message
        vals[field] = value
    vals["webhook_signature"] = str(form.get("webhook_signature", "")).strip().lower()
    if vals["webhook_signature"] not in SIGNATURES:
        errors["webhook_signature"] = "Choose how the vendor signs webhook requests."
    vals["offsets_sunset"] = parse_date(form.get("offsets_sunset"))
    if not vals["offsets_sunset"]:
        errors["offsets_sunset"] = "Enter a date, for example 2027-06-30."
    vals["notes"] = str(form.get("notes", "")).strip()[:4000]
    if str(form.get("confirm_sources", "")).lower() not in ("on", "true", "yes", "1"):
        errors["confirm_sources"] = "Confirm where these values came from."
    return vals, errors


def grade(vals):
    def same_number(a, b):
        return a is not None and abs(a - b) < 0.5

    return {
        "vendor": EXPECTED["vendor"] in vals["vendor"].lower(),
        "api_version": vals["api_version"] == EXPECTED["api_version"],
        "team_rate_limit": same_number(vals["team_rate_limit"], EXPECTED["team_rate_limit"]),
        "webhook_payload_kb": same_number(vals["webhook_payload_kb"], EXPECTED["webhook_payload_kb"]),
        "webhook_signature": re.sub(r"[^a-z0-9]", "", vals["webhook_signature"]) == EXPECTED["webhook_signature"],
        "enterprise_audit_days": same_number(vals["enterprise_audit_days"], EXPECTED["enterprise_audit_days"]),
        "offsets_sunset": vals["offsets_sunset"] == EXPECTED["offsets_sunset"],
    }


def check():
    with LOCK:
        subs = list(STATE["submissions"])
        rejected, shown, reset_at = STATE["rejected"], STATE["errors_shown"], STATE["reset_at_ms"]
    total = len(EXPECTED)
    counters = {"submissions": len(subs), "rejected_submissions": rejected, "validation_errors_shown": shown}
    if not subs:
        return {"pass": False, "matched": 0, "total": total, "completed_at_ms": None, "reset_at_ms": reset_at,
                "details": dict(counters, wrong_fields=sorted(EXPECTED), submitted=None)}
    latest = subs[-1]
    result = grade(latest["values"])
    passed = all(result.values())
    return {"pass": passed, "matched": sum(result.values()), "total": total,
            "completed_at_ms": latest["at_ms"] if passed else None, "reset_at_ms": reset_at,
            "details": dict(counters, wrong_fields=sorted(k for k, ok in result.items() if not ok),
                            submitted=latest["raw"], submitted_at_ms=latest["at_ms"])}


class DocsHandler(Handler):
    def do_GET(self):
        path = self.path_only
        if path in ("/", "/docs", "/docs/"):
            return self.redirect(f"/{LATEST}/")
        if path.startswith("/assets/"):
            return self.static(path[len("/assets"):])
        if path == "/search":
            try:
                page_no = int(self.query.get("page", "1"))
            except ValueError:
                page_no = 1
            version = self.query.get("v", "")
            return self.html(200, search_html(self.query.get("q", ""), version if version in VERSIONS else "", page_no))
        m = re.fullmatch(r"/(v\d)/?(.*?)/?", path)
        if m and m.group(1) in DOCS:
            v, slug = m.group(1), m.group(2) or DOCS[m.group(1)]["order"][0]
            if slug in DOCS[v]["pages"]:
                return self.html(200, page_html(v, slug))
        body = f'<main id="content" class="content"><h1>Page not found</h1><p>We couldn’t find <code>{esc(path)}</code>. It may have moved in a newer version. Try <a href="/search?q={quote(path.rsplit("/", 1)[-1].replace("-", " "))}">searching</a>.</p></main>'
        return self.html(404, layout("Page not found", LATEST, body))


class ReviewHandler(Handler):
    def do_GET(self):
        if self.path_only == "/api/check":
            return self.send(200, check())
        return self.static()

    def do_POST(self):
        if self.path_only == "/api/reset":
            reset_state()
            return self.send(200, {"ok": True})
        if self.path_only == "/api/review":
            form = self.body_json()
            if not isinstance(form, dict):
                return self.send(400, {"error": "Invalid request."})
            vals, errors = validate(form)
            raw = {k: str(form.get(k, ""))[:200] for k in ("vendor", "api_version", "team_rate_limit", "webhook_payload_kb",
                                                          "webhook_signature", "enterprise_audit_days", "offsets_sunset", "notes", "confirm_sources")}
            with LOCK:
                if errors:
                    STATE["rejected"] += 1
                    STATE["errors_shown"] += len(errors)
                    return self.send(422, {"errors": errors})
                at_ms = now_ms()
                STATE["submissions"].append({"values": vals, "raw": raw, "at_ms": at_ms})
                count = len(STATE["submissions"])
            return self.send(201, {"ok": True, "number": count, "submitted_at": at_ms})
        self.send(404, {"error": "not found"})


if __name__ == "__main__":
    reset_state()
    serve_forever([(DOCS_PORT, DocsHandler, HERE / "fixture" / "docs"), (REVIEW_PORT, ReviewHandler, HERE / "fixture" / "review")],
                  f"research docs http://127.0.0.1:{DOCS_PORT}/ review http://127.0.0.1:{REVIEW_PORT}/")
