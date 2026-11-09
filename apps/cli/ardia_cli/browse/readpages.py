import asyncio
import re
from concurrent.futures import ThreadPoolExecutor

from ardia_cli.browse.errors import BrowseError, ConnectionLost, Usage

READ_TABS = 4
HTTP_WORKERS = 4
DEFAULT_LIMIT = 20
MAX_LIMIT = 100
PAGE_TIMEOUT_MS = 20000
LOAD_GRACE = 5.0
SETTLE_LIMIT = 3.0
SETTLE_QUIET = 0.3
SETTLE_POLL = 0.1
SAME_DOCUMENT_WAIT = 3.0
MIN_USEFUL = 120
CUT_MARK = 24
MAX_STDIN = 1024 * 1024

LINKS = r"""() => {
  const out = [];
  for (const a of document.querySelectorAll("a[href]")) {
    let url;
    try { url = new URL(a.getAttribute("href"), document.baseURI); } catch (e) { continue; }
    if (url.protocol === "http:" || url.protocol === "https:") out.push(url.href);
  }
  return out;
}"""

EXTRACT = r"""(selector) => {
  let roots;
  if (selector) {
    roots = ardiaBrowse.queryAll(selector);
  } else {
    const main = document.querySelector("main, [role=main]");
    roots = main && (main.innerText || "").trim() ? [main] : [document.body || document.documentElement];
  }
  const text = roots.filter(Boolean).map((root) => ardiaBrowse.readable(root)).filter(Boolean).join("\n\n");
  let status = null;
  try {
    const entry = performance.getEntriesByType("navigation")[0];
    status = entry && entry.responseStatus ? entry.responseStatus : null;
  } catch (e) {}
  return { title: document.title || "", text, matched: roots.length, status };
}"""

SETTLE_PROBE = r"""() => {
  const text = document.body ? document.body.innerText || "" : "";
  let hash = 0;
  for (let index = 0; index < text.length; index++) hash = (hash * 31 + text.charCodeAt(index)) | 0;
  const busy = /(^|\n)\s*loading(\.\.\.|…)?\s*(\n|$)/i.test(text) || !!document.querySelector("[aria-busy=true]");
  return [document.readyState, text.length + ":" + hash, busy];
}"""
HTTP_ONLY = ("llms", "require_md", "raw")


def flags() -> dict:
    from ardia_cli.browse import readurl

    return {**readurl.FLAGS, "--http": "bool", "--stdin": "bool", "--links": "value", "--limit": "value", "--selector": "value", "--list": "bool"}


ALIASES = {"-s": "--selector"}


def reads_stdin(options: dict, positional: list[str]) -> bool:
    return bool(options.get("stdin") or "-" in positional)


def wants_pages(options: dict, positional: list[str]) -> bool:
    return bool(positional or options.get("stdin") or options.get("links") is not None)


def relative(url: str) -> bool:
    return url.startswith(("/", "./", "../", "?", "#")) and not url.startswith("//")


def fetch_only(options: dict) -> bool:
    return bool(options.get("http") or any(options.get(name) for name in HTTP_ONLY))


def single_fetch(options: dict, positional: list[str]) -> bool:
    return len(positional) == 1 and positional != ["-"] and not options.get("stdin") and options.get("links") is None and fetch_only(options)


def runs_locally(options: dict, positional: list[str]) -> bool:
    return (wants_pages(options, positional) and options.get("links") is None and fetch_only(options)
            and not any(relative(url) for url in positional))


def parse_limit(value) -> int:
    if value is None:
        return DEFAULT_LIMIT
    if not str(value).isdigit() or not 1 <= int(value) <= MAX_LIMIT:
        raise Usage(f"--limit takes a number of pages from 1 to {MAX_LIMIT}, not {value}")
    return int(value)


def page_timeout(options: dict) -> float:
    value = options.get("timeout")
    if value is None:
        return PAGE_TIMEOUT_MS / 1000
    if not str(value).isdigit() or int(value) <= 0:
        raise Usage(f"--timeout takes milliseconds per page, not {value}")
    return int(value) / 1000


def url_lines(text: str) -> list[str]:
    urls = []
    for line in (text or "").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        urls.extend(line.split())
    return urls


def link_matcher(pattern: str):
    if "*" not in pattern:
        return lambda url: pattern in url
    regex = re.compile(".*".join(re.escape(part) for part in pattern.split("*")))
    return lambda url: regex.search(url) is not None


def canonical_link(url: str) -> str:
    base, hash_mark, fragment = url.partition("#")
    return url if hash_mark and fragment.startswith(("/", "!")) else base


def distinct_links(raw: list[str]) -> list[str]:
    out = []
    for url in raw:
        url = canonical_link(url)
        if url not in out:
            out.append(url)
    return out


def pick_links(links: list[str], pattern: str, skip: str | None = None) -> list[str]:
    matches = link_matcher(pattern)
    current = canonical_link(skip or "")
    return [url for url in links if matches(url) and url != current]


def no_links_message(pattern: str, page_url: str, links: list[str]) -> str:
    if not links:
        return f"The page has no links to read ({page_url})"
    from urllib.parse import urlsplit

    samples = []
    for url in links:
        parts = urlsplit(url)
        path = parts.path + (f"?{parts.query}" if parts.query else "")
        if path not in samples:
            samples.append(path)
        if len(samples) == 6:
            break
    return f"No link on {page_url} matches {pattern!r} ({len(links)} links, such as {', '.join(samples)})"


def wanted_urls(options: dict, positional: list[str], stdin: str | None, base: str | None = None) -> list[str]:
    from urllib.parse import urljoin

    from ardia_cli.browse.commands import normalize_url

    urls = [url for url in positional if url != "-"]
    if reads_stdin(options, positional):
        urls.extend(url_lines(stdin))
    out = []
    for url in urls:
        if relative(url):
            if not base:
                raise Usage(f"{url} is relative; give a full URL, or read it from a session that has a tab")
            url = urljoin(base, url)
        url = normalize_url(url)
        if url not in out:
            out.append(url)
    return out


def shares(lengths: list[int], budget: int) -> list[int]:
    allowed = [0] * len(lengths)
    order = sorted(range(len(lengths)), key=lambda index: lengths[index])
    left = max(budget, 0)
    for position, index in enumerate(order):
        allowed[index] = min(lengths[index], left // (len(order) - position))
        left -= allowed[index]
    return allowed


def cut(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    at = text.rfind("\n", 0, limit + 1)
    at = at if at >= limit * 0.8 else limit
    kept = text[:at].rstrip()
    return (kept + "\n" if kept else "") + f"… [+{len(text) - at:,} characters]"


def header(record: dict, index: int, total: int) -> str:
    place = f"[{index}/{total}] " if total > 1 else ""
    url = record.get("finalUrl") or record["url"]
    if record.get("error"):
        return f"=== {place}✗ {url}\n{record['error']}"
    status = f" (HTTP {record['status']})" if record.get("status") and record["status"] >= 400 else ""
    return f"=== {place}{record.get('title') or '(no title)'}{status}\n{url}"


def footer(limit: int, cut_any: bool, hidden: int, wanted: int) -> str:
    parts = [f"pages cut to fit {limit:,} characters"] if cut_any else []
    if hidden:
        parts.append(f"+{hidden} page{'s' if hidden != 1 else ''} not shown")
    return (f"[{'; '.join(parts)}. Narrow it instead: -s <css> (one region per page), a tighter --links pattern, or --limit <n>. "
            f"Only if you need every line: --max-output {wanted}]")


def render(records: list[dict], options: dict, extra: str = "") -> str:
    from ardia_cli.browse.daemon import OUTPUT_CAP
    from ardia_cli.redact import redact

    heads = [redact(header(record, index + 1, len(records))) for index, record in enumerate(records)]
    texts = [redact(record.get("text") or ("" if record.get("error") else "(no text)")) for record in records]
    extra = redact(extra)
    limit = None if options.get("full") else (OUTPUT_CAP if options.get("max_output") is None else int(options["max_output"]))
    whole = join(heads, texts, [extra])
    if not limit or limit <= 0 or len(whole) <= limit:
        return whole
    for shown in range(len(records), -1, -1):
        out = fit(heads[:shown], texts[:shown], len(records) - shown, limit, extra, len(whole) + 300)
        if out is not None:
            return out
    return footer(limit, False, len(records), len(whole) + 300)[:limit]


def fit(heads: list[str], texts: list[str], hidden: int, limit: int, extra: str, wanted: int) -> str | None:
    lengths = [len(text) for text in texts]
    needed = sum(min(length, MIN_USEFUL) for length in lengths)
    longest = footer(limit, True, hidden, wanted)
    budget = limit - len(join(heads, [""] * len(heads), [extra, longest])) - (CUT_MARK + 1) * len(texts)
    best = None
    for _ in range(4):
        if budget < needed:
            return best
        allowed = shares(lengths, budget)
        cut_any = any(room < length for room, length in zip(allowed, lengths))
        tail = [extra, footer(limit, cut_any, hidden, wanted)] if cut_any or hidden else [extra]
        out = join(heads, [cut(text, room) for text, room in zip(texts, allowed)], tail)
        if len(out) > limit:
            budget -= len(out) - limit
            continue
        best = out
        if not cut_any or limit - len(out) < 40:
            return out
        budget += limit - len(out)
    return best


def join(heads: list[str], texts: list[str], tail: list[str]) -> str:
    blocks = [f"{head}\n{text}" if text else head for head, text in zip(heads, texts)]
    tail = [line for line in tail if line]
    return "\n\n".join(blocks + (["\n".join(tail)] if tail else []))


async def collect_links(ctx, pattern: str):
    page = await ctx.state.page()
    await page.refresh_frames()
    frame = ctx.state.frame_for(page) or page.main_frame
    links = distinct_links(await page.call(LINKS, frame=frame, read=True) or [])
    return page.url, links, pick_links(links, pattern, page.url)


async def open_reader(state, opened: list[str]):
    from ardia_cli.browse import temptabs
    from ardia_cli.browse.page import Page

    target_id = await temptabs.create(state, opened)
    state.target_infos.setdefault(target_id, {"targetId": target_id, "url": "about:blank", "title": "", "type": "page"})
    page = state.pages[target_id] = Page(state, target_id)
    await page.attach(state.browser)
    return page


async def probe(page):
    try:
        return tuple(await page.call(SETTLE_PROBE, frame=page.main_frame, read=True))
    except BrowseError:
        return None, None, True


async def settle(page, deadline: float):
    loop = asyncio.get_running_loop()
    last = None
    since = loop.time()
    while loop.time() < deadline:
        ready, fingerprint, busy = await probe(page)
        now = loop.time()
        if (ready, fingerprint, busy) != last:
            last, since = (ready, fingerprint, busy), now
        elif ready == "complete" and not busy and now - since >= SETTLE_QUIET:
            return
        await asyncio.sleep(SETTLE_POLL)


async def route_changed(page, before, deadline: float):
    loop = asyncio.get_running_loop()
    while loop.time() < deadline:
        _, fingerprint, busy = await probe(page)
        if busy or fingerprint != before:
            return
        await asyncio.sleep(SETTLE_POLL / 2)


def same_document(page, url: str) -> bool:
    current = page.url or ""
    return "#" in url and not current.startswith("about:") and current.partition("#")[0] == url.partition("#")[0]


async def before_navigating(page, url: str):
    return (await probe(page))[1] if same_document(page, url) else None


async def after_same_document(page, before, deadline: float):
    loop = asyncio.get_running_loop()
    await route_changed(page, before, min(deadline, loop.time() + SAME_DOCUMENT_WAIT))
    await settle(page, min(deadline, loop.time() + SETTLE_LIMIT))


async def goto(ctx, page, url: str, timeout: float):
    from ardia_cli.browse.commands import wait_for_load
    from ardia_cli.browse.errors import Gated

    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    before = await before_navigating(page, url)
    try:
        result = await page.send("Page.navigate", {"url": url}, timeout=timeout)
    except Gated:
        raise BrowseError(f"Ardia's policy only lets the ardia command open web pages; {url} isn't one") from None
    if result.get("errorText"):
        raise BrowseError(f"couldn't load it: {result['errorText']}")
    loader = result.get("loaderId")
    if loader:
        await wait_for_load(page, loader, max(deadline - loop.time(), 0.1), "domcontentloaded")
        try:
            await wait_for_load(page, loader, min(LOAD_GRACE, max(deadline - loop.time(), 0.1)), "load")
        except BrowseError:
            pass
        await settle(page, min(deadline, loop.time() + SETTLE_LIMIT))
    else:
        await after_same_document(page, before, deadline)
    await page.refresh_frames()


async def read_in(ctx, page, url: str, selector: str | None, timeout: float, options: dict) -> dict:
    from ardia_cli.browse import readurl

    record = {"url": url, "source": "browser"}
    try:
        await goto(ctx, page, url, timeout)
        got = await page.call(EXTRACT, selector, frame=page.main_frame, read=True)
    except ConnectionLost:
        raise
    except BrowseError as error:
        record["error"] = error.message
        return record
    record.update(finalUrl=page.url, title=got.get("title") or "", status=got.get("status"),
                  text=readurl.post_process(got.get("text") or "", options))
    if selector and not got.get("matched"):
        record["error"] = f"nothing on the page matches {selector}"
    return record


async def read_tabs(ctx, urls: list[str], selector: str | None, timeout: float, options: dict) -> list[dict]:
    from ardia_cli.browse import temptabs

    state = ctx.state
    await state.connect()
    await temptabs.sweep(state)
    queue = list(enumerate(urls))
    records: list = [None] * len(urls)
    opened: list[str] = []

    async def worker():
        page = None
        while queue:
            index, url = queue.pop(0)
            if page is None or page.session_id is None:
                page = await open_reader(state, opened)
            records[index] = await read_in(ctx, page, url, selector, timeout, options)

    tasks = [asyncio.ensure_future(worker()) for _ in range(min(READ_TABS, len(urls)))]
    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_EXCEPTION)
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        for task in done:
            task.result()
    finally:
        from ardia_cli.browse import temptabs

        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await temptabs.release(state, opened)
    return records


def read_http_one(url: str, options: dict) -> dict:
    from ardia_cli.browse import readurl

    record = {"url": url, "source": "http"}
    try:
        result = readurl.run(url, dict(options), {})
    except BrowseError as error:
        record["error"] = error.message
        return record
    data = result.data
    record.update(finalUrl=data.get("finalUrl") or url, title=data.get("title") or "", text=data.get("content") or "")
    return record


def read_http(urls: list[str], options: dict) -> list[dict]:
    with ThreadPoolExecutor(max_workers=min(HTTP_WORKERS, len(urls))) as pool:
        return list(pool.map(lambda url: read_http_one(url, options), urls))


def result_for(records: list[dict], options: dict, global_options: dict, extra: str = "", data_extra: dict | None = None):
    from ardia_cli.browse.commands import Result

    result = Result({"pages": records, **(data_extra or {})}, render(records, global_options, extra), page_content=True)
    if any(record.get("error") for record in records):
        result.failed = True
    return result


def run_local(options: dict, positional: list[str], stdin: str | None, global_options: dict):
    urls = wanted_urls(options, positional, stdin)
    if not urls:
        raise Usage("Usage: ardia browse read <url>... [--stdin] [--links <pattern>] [-s <selector>] [--http]")
    limit = parse_limit(options.get("limit"))
    page_timeout(options)
    if options.get("selector"):
        raise Usage("-s needs the browser's DOM; drop --http to read the pages in Ardia")
    extra = limit_note(len(urls), limit, "--limit")
    return result_for(read_http(urls[:limit], options), options, global_options, extra)


def limit_note(found: int, limit: int, flag: str) -> str:
    if found <= limit:
        return ""
    return f"[read the first {limit} of {found} pages; {flag} {min(found, MAX_LIMIT)} for more]"


async def run(ctx, options: dict, positional: list[str]):
    limit = parse_limit(options.get("limit"))
    timeout = page_timeout(options)
    selector = options.get("selector")
    base = None
    if any(relative(url) for url in positional) or (reads_stdin(options, positional) and any(relative(url) for url in url_lines(ctx.stdin))):
        page = await ctx.state.page()
        await page.refresh_frames()
        base = page.url
    urls = wanted_urls(options, positional, ctx.stdin, base)
    data_extra = {}
    if options.get("links") is not None:
        source, links, picked = await collect_links(ctx, options["links"])
        if not picked:
            raise BrowseError(no_links_message(options["links"], source, links), data={"links": len(links)}, code="no_links")
        data_extra = {"listing": source, "matched": len(picked)}
        urls += [url for url in picked if url not in urls]
        if options.get("list"):
            from ardia_cli.browse.commands import Result

            shown = picked[:limit] if options.get("limit") is not None else picked
            text = "\n".join(shown) + (f"\n{limit_note(len(picked), limit, '--limit')}" if len(shown) < len(picked) else "")
            return Result({"links": shown, "matched": len(picked), "listing": source}, text, page_content=True)
    elif options.get("list"):
        raise Usage("--list goes with --links <pattern>: it prints the links that read would visit")
    if not urls:
        raise Usage("Usage: ardia browse read <url>... [--stdin] [--links <pattern>] [-s <selector>] [--http]")
    extra = limit_note(len(urls), limit, "--limit")
    urls = urls[:limit]
    if fetch_only(options):
        if selector:
            raise Usage("-s needs the browser's DOM; drop --http to read the pages in Ardia")
        records = await asyncio.to_thread(read_http, urls, options)
    else:
        records = await read_tabs(ctx, urls, selector, timeout, options)
    return result_for(records, options, ctx.options, extra, data_extra)
