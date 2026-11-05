import html.parser
import re
import urllib.error
import urllib.request
from urllib.parse import urljoin, urlsplit, urlunsplit

from ardia_cli.browse.errors import BrowseError

FLAGS = {"--raw": "bool", "--require-md": "bool", "--llms": "value", "--outline": "bool", "--filter": "value", "--timeout": "value"}
MAX_BODY = 8 * 1024 * 1024
MARKDOWN_TYPES = ("text/markdown", "text/x-markdown")
LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")


class TextExtractor(html.parser.HTMLParser):
    SKIP = {"script", "style", "noscript", "template", "svg", "head", "nav", "footer"}
    BLOCK = {"p", "div", "section", "article", "main", "header", "ul", "ol", "table", "tr", "blockquote", "pre", "br", "hr", "form", "dl", "dt", "dd"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.lines = []
        self.buffer = []
        self.skip = 0
        self.heading = None
        self.title = ""
        self.in_title = False

    def flush(self):
        text = re.sub(r"\s+", " ", "".join(self.buffer)).strip()
        if text:
            self.lines.append(text)
        self.buffer = []

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self.in_title = True
        if tag in self.SKIP:
            self.skip += 1
            return
        if re.fullmatch(r"h[1-6]", tag):
            self.flush()
            self.heading = int(tag[1])
        elif tag == "li":
            self.flush()
            self.buffer.append("- ")
        elif tag in self.BLOCK:
            self.flush()

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag in self.SKIP:
            self.skip = max(0, self.skip - 1)
            return
        if re.fullmatch(r"h[1-6]", tag) and self.heading:
            text = re.sub(r"\s+", " ", "".join(self.buffer)).strip()
            self.buffer = []
            if text:
                self.lines += ["", "#" * self.heading + " " + text, ""]
            self.heading = None
        elif tag in self.BLOCK or tag == "li":
            self.flush()

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        if not self.skip:
            self.buffer.append(data)

    def text(self) -> str:
        self.flush()
        out = []
        for line in self.lines:
            if line == "" and (not out or out[-1] == ""):
                continue
            out.append(line)
        return "\n".join(out).strip()


def fetch(url: str, timeout: float, accept: str = "text/markdown, text/plain;q=0.9, text/html;q=0.8, */*;q=0.5"):
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise BrowseError(f"read fetches http(s) URLs only, not {url}")
    request = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": "ardia-browse-read/1"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read(MAX_BODY + 1)
            content_type = response.headers.get("Content-Type", "")
            final = response.geturl()
            status = response.status
    except urllib.error.HTTPError as error:
        return error.code, "", "", url
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise BrowseError(f"Couldn't fetch {url}: {getattr(error, 'reason', error)}") from None
    charset = re.search(r"charset=([\w-]+)", content_type)
    text = body[:MAX_BODY].decode(charset.group(1) if charset else "utf-8", errors="replace")
    return status, content_type.split(";")[0].strip().lower(), text, final


def sections(markdown: str) -> list[tuple[str, list[str]]]:
    out = [("", [])]
    for line in markdown.splitlines():
        if re.match(r"^#{1,6} ", line):
            out.append((line, [line]))
        else:
            out[-1][1].append(line)
    return out


def post_process(content: str, options: dict) -> str:
    if options.get("outline"):
        headings = [line for line in content.splitlines() if re.match(r"^#{1,6} ", line)]
        if options.get("filter"):
            headings = [line for line in headings if options["filter"].lower() in line.lower()]
        return "\n".join("  " * (len(line) - len(line.lstrip("#")) - 1) + line.lstrip("#").strip() for line in headings)
    if options.get("filter"):
        wanted = options["filter"].lower()
        kept = ["\n".join(lines).strip() for heading, lines in sections(content) if heading and wanted in heading.lower()]
        if not kept:
            kept = ["\n".join(lines).strip() for heading, lines in sections(content) if wanted in "\n".join(lines).lower()]
        return "\n\n".join(kept)
    return content


def nearest_llms(url: str, timeout: float, name: str = "llms.txt"):
    parts = urlsplit(url)
    path = parts.path.rstrip("/")
    while True:
        candidate = urlunsplit((parts.scheme, parts.netloc, (path or "") + "/" + name, "", ""))
        status, kind, text, final = fetch(candidate, timeout, "text/plain, text/markdown")
        if status == 200 and text and "<html" not in text[:500].lower():
            return final, text
        if not path:
            return None, None
        path = path.rsplit("/", 1)[0]


def run(url: str, options: dict, global_options: dict):
    from ardia_cli.browse.commands import Result, normalize_url

    url = normalize_url(url)
    timeout = float(options.get("timeout") or 10000) / 1000
    if options.get("llms"):
        mode = options["llms"]
        if mode not in ("index", "full"):
            raise BrowseError("--llms takes index or full")
        source, text = nearest_llms(url, timeout, "llms.txt" if mode == "index" else "llms-full.txt")
        if text is None:
            raise BrowseError(f"No {'llms.txt' if mode == 'index' else 'llms-full.txt'} found at or above {url}")
        if mode == "index":
            links = [f"- {title}: {urljoin(source, href)}" for title, href in LINK.findall(text)]
            if options.get("filter"):
                links = [line for line in links if options["filter"].lower() in line.lower()]
            content = "\n".join(links)
        else:
            content = post_process(text, options)
        return Result({"content": content, "source": source, "contentType": "text/plain", "url": url}, content, page_content=True)
    status, kind, text, final = fetch(url, timeout)
    if status >= 400:
        raise BrowseError(f"{url} answered HTTP {status}")
    source = "response"
    if kind not in MARKDOWN_TYPES and not options.get("raw"):
        if not urlsplit(final).path.endswith(".md"):
            md_status, md_kind, md_text, md_final = fetch(final.rstrip("/") + ".md", timeout)
            if md_status == 200 and (md_kind in MARKDOWN_TYPES or (md_kind == "text/plain" and md_text and "<html" not in md_text[:300].lower())):
                status, kind, text, final, source = md_status, "text/markdown", md_text, md_final, "md-suffix"
        if kind not in MARKDOWN_TYPES:
            llms_source, llms_text = nearest_llms(final, timeout)
            if llms_text:
                for _, href in LINK.findall(llms_text):
                    target = urljoin(llms_source, href)
                    if target.rstrip("/").removesuffix(".md") == final.rstrip("/").removesuffix(".md") and target.endswith(".md"):
                        md_status, _, md_text, md_final = fetch(target, timeout)
                        if md_status == 200:
                            status, kind, text, final, source = md_status, "text/markdown", md_text, md_final, "llms.txt"
                        break
    if options.get("require_md") and kind not in MARKDOWN_TYPES:
        raise BrowseError(f"{url} didn't answer with text/markdown (got {kind or 'nothing'})")
    content = text
    if not options.get("raw") and kind == "text/html":
        extractor = TextExtractor()
        extractor.feed(text)
        content = extractor.text()
        source = "html-extract"
    content = post_process(content, options) if not options.get("raw") else content
    max_output = global_options.get("max_output")
    truncated = bool(max_output and len(content) > int(max_output))
    return Result({"content": content, "contentType": kind, "finalUrl": final, "source": source, "truncated": truncated, "url": url}, content, page_content=True)
