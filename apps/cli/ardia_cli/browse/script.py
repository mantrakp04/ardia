import asyncio
import json
import re

from ardia_cli.browse.errors import BrowseError, ConnectionLost, OutcomeUnknown, Usage

DEFAULT_TIMEOUT = 90.0
MAX_TIMEOUT = 600.0
MAX_SOURCE = 1024 * 1024
LOG_LIMIT = 1024 * 1024
CONTROL_TIMEOUT = 5.0
CLOSE_TIMEOUT = 3.0
SOURCE_URL = "ardia-script.js"
REFUSED = ("close", "script")
TITLE = "ardia browse script"

CONTROLLER = r"""
(() => {
  if (globalThis.__ardiaScript) return globalThis.__ardiaScript;
  const SOURCE = "ardia-script.js";
  const LOG_LIMIT = %(log_limit)d;
  const pending = [];
  const waiting = new Map();
  const logs = [];
  let logSize = 0;
  let logsDropped = 0;
  let wake = null;
  let finished = null;
  let nextId = 1;
  const show = (value) => {
    if (typeof value === "string") return value;
    if (value === undefined) return "undefined";
    if (value instanceof Error) return value.stack || String(value);
    try { const text = JSON.stringify(value, null, 2); return text === undefined ? String(value) : text; } catch (e) { return String(value); }
  };
  const lineOf = (stack) => {
    const match = new RegExp(SOURCE.replace(/[.]/g, "\\.") + ":(\\d+):(\\d+)").exec(String(stack || ""));
    return match ? Math.max(Number(match[1]) - 1, 1) : null;
  };
  const signal = () => { if (wake) { const resolve = wake; wake = null; resolve(); } };
  const log = (...args) => {
    const line = args.map(show).join(" ");
    if (logSize + line.length > LOG_LIMIT) { logsDropped += 1; return; }
    logs.push(line);
    logSize += line.length + 1;
  };
  const request = (kind, payload) => {
    const origin = new Error();
    const line = lineOf(origin.stack);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject, origin, line, argv: payload.argv });
      pending.push({ id, type: kind, line, ...payload });
      signal();
    });
  };
  const words = (value) => value == null ? [] : (Array.isArray(value) ? value.map(String) : String(value).trim().split(/\s+/).filter(Boolean));
  const browse = (...argv) => request("call", { argv: argv.flat().map(String) });
  const absolute = async (url) => {
    url = String(url);
    if (!/^(\/|\.\.?\/|\?|#)/.test(url)) return url;
    const base = (await browse("get", "url")).data.url;
    return new URL(url, base).href;
  };
  const text = (answer) => answer.text;
  const data = (key) => (answer) => (answer.data || {})[key];
  const flags = (options, table) => {
    const out = [];
    for (const [key, flag] of Object.entries(table)) {
      const value = options && options[key];
      if (value === undefined || value === null || value === false) continue;
      out.push(flag);
      if (value !== true) out.push(String(value));
    }
    return out;
  };
  const read = async (what, options) => {
    options = options || {};
    let argv = ["read"];
    if (what && typeof what === "object" && !Array.isArray(what)) { options = { ...what, ...options }; what = options.urls; }
    for (const url of words(what)) argv.push(await absolute(url));
    argv = argv.concat(flags(options, { links: "--links", selector: "-s", limit: "--limit", timeout: "--timeout", http: "--http" }));
    return (await browse(argv)).data.pages;
  };
  const page = {
    goto: async (url) => (await browse("open", await absolute(url))).data,
    back: () => browse("back").then(data("url")),
    forward: () => browse("forward").then(data("url")),
    reload: () => browse("reload").then(data("url")),
    click: (selector, options) => browse("click", selector, flags(options, { newTab: "--new-tab", button: "--button" })).then(text),
    dblclick: (selector) => browse("dblclick", selector).then(text),
    fill: (selector, value) => browse("fill", selector, String(value)).then(text),
    type: (selector, value) => browse("type", selector, String(value)).then(text),
    press: (key) => browse("press", key).then(text),
    select: (selector, ...values) => browse("select", selector, ...values.flat()).then(text),
    check: (selector) => browse("check", selector).then(text),
    uncheck: (selector) => browse("uncheck", selector).then(text),
    hover: (selector) => browse("hover", selector).then(text),
    scroll: (direction, pixels) => browse("scroll", ...words(direction), ...words(pixels)).then(text),
    text: (selector) => selector == null ? browse("read").then(data("content")) : browse("get", "text", selector).then(data("text")),
    value: (selector) => browse("get", "value", selector).then(data("value")),
    attr: (selector, name) => browse("get", "attr", selector, name).then(data("value")),
    count: (selector) => browse("get", "count", selector).then(data("count")),
    visible: (selector) => browse("is", "visible", selector).then(data("visible")),
    url: () => browse("get", "url").then(data("url")),
    title: () => browse("get", "title").then(data("title")),
    snapshot: (options) => browse("snapshot", ...(typeof options === "string" || Array.isArray(options) ? words(options)
      : flags(options, { interactive: "-i", compact: "-c", depth: "-d", selector: "-s", urls: "-u", diff: "--diff" }))).then(text),
    links: (pattern) => browse("read", "--links", pattern == null ? "" : String(pattern), "--list").then(data("links"),
      (error) => { if (error.code === "no_links") return []; throw error; }),
    wait: (what, options) => {
      if (typeof what === "number") return request("sleep", { ms: what }).then(() => undefined);
      if (what && typeof what === "object") { options = what; what = undefined; }
      return browse("wait", ...words(what), ...flags(options, { text: "--text", url: "--url", load: "--load", fn: "--fn", state: "--state", timeout: "--timeout" })).then(text);
    },
    evaluate: (fn, arg) => browse("eval", typeof fn === "function" ? "(" + fn + ")(" + (arg === undefined ? "" : JSON.stringify(arg)) + ")" : String(fn)).then(data("result")),
  };
  const sleep = (ms) => request("sleep", { ms: Number(ms) || 0 }).then(() => undefined);
  const clean = (value) => {
    if (value === undefined) return { undefined: true };
    try { return { value: JSON.parse(JSON.stringify(value)) }; } catch (e) { return { value: show(value) }; }
  };
  const api = {
    start(run) {
      (async () => {
        try {
          finished = { kind: "done", ...clean(await run()) };
        } catch (error) {
          finished = {
            kind: "error",
            message: error && error.message !== undefined ? String(error.message) : show(error),
            name: error && error.name ? String(error.name) : "Error",
            line: lineOf(error && error.stack),
            code: error && error.code ? String(error.code) : null,
            command: error && error.argv ? error.argv : null,
          };
        }
        signal();
      })();
      return true;
    },
    async next() {
      while (true) {
        if (finished) return { ...finished, unawaited: pending.length, logs, logsDropped };
        if (pending.length) return { kind: "request", ...pending.shift() };
        await new Promise((resolve) => { wake = resolve; });
      }
    },
    reply(id, answer) {
      const entry = waiting.get(id);
      if (!entry) return false;
      waiting.delete(id);
      if (answer.ok) { entry.resolve(answer); return true; }
      const error = entry.origin;
      error.message = answer.error;
      error.code = answer.code || null;
      error.argv = entry.argv || null;
      entry.reject(error);
      return true;
    },
    logs() { return { logs, logsDropped }; },
  };
  Object.assign(globalThis, { page, browse, read, log, sleep, __ardiaScript: api });
  console.log = log;
  console.info = log;
  console.warn = log;
  console.error = log;
  document.title = %(title)s;
  return api;
})()
"""


def parse_timeout(value) -> float:
    if value is None:
        return DEFAULT_TIMEOUT
    match = re.fullmatch(r"(\d+(?:\.\d+)?)(ms|s|m)?", str(value).strip())
    if not match:
        raise Usage(f"--timeout takes 30s, 2m or milliseconds, not {value}")
    seconds = float(match.group(1)) * {"ms": 0.001, "s": 1, "m": 60}[match.group(2) or "ms"]
    if seconds <= 0 or seconds > MAX_TIMEOUT:
        raise Usage(f"--timeout goes up to {MAX_TIMEOUT / 60:g}m, not {value}")
    return seconds


def wrap(source: str) -> str:
    return f"globalThis.__ardiaScript.start(async () => {{\n{source}\n}});\n//# sourceURL={SOURCE_URL}"


def source_line(source: str, wrapped_line: int | None) -> int | None:
    if wrapped_line is None:
        return None
    lines = source.count("\n") + 1
    return min(max(wrapped_line, 1), lines)


def show_argv(argv) -> str:
    import shlex

    return " ".join(shlex.quote(str(word)) for word in argv or [])


def render_value(message: dict) -> str | None:
    if message.get("undefined"):
        return None
    value = message.get("value")
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, indent=2)


def tail(lines: list[str], limit: int = 3000) -> str:
    text = "\n".join(lines)
    if len(text) <= limit:
        return text
    return f"… [{len(text) - limit:,} earlier characters]\n" + text[-limit:]


def failure(message: str, logs: list[str], data: dict, code: str | None = None) -> BrowseError:
    body = message
    if logs:
        body += "\nlogged before that:\n" + tail(logs)
    return BrowseError(body, data={**data, "logs": logs}, code=code or "script_failed")


async def open_controller(state):
    from ardia_cli.browse.errors import Gated
    from ardia_cli.browse.page import Page

    try:
        result = await state.browser.send("Target.createTarget", {"url": "about:blank", "background": True})
    except Gated:
        raise BrowseError("Ardia's policy refused to open a tab for the ardia command") from None
    target_id = result["targetId"]
    page = state.pages[target_id] = Page(state, target_id)
    try:
        await page.attach(state.browser)
    except BaseException:
        await close_controller(state, target_id)
        raise
    return page


async def close_controller(state, target_id: str):
    try:
        if state.connected:
            await asyncio.wait_for(state.browser.send("Target.closeTarget", {"targetId": target_id}), CLOSE_TIMEOUT)
    except Exception:
        pass
    state.forget_target(target_id)


async def evaluate(page, expression: str, timeout: float = CONTROL_TIMEOUT, by_value: bool = True) -> dict:
    return await page.send("Runtime.evaluate", {"expression": expression, "returnByValue": by_value, "awaitPromise": True}, timeout=timeout)


async def control(page, handle: str, function: str, *args, timeout: float = CONTROL_TIMEOUT):
    result = await page.send("Runtime.callFunctionOn", {
        "objectId": handle, "functionDeclaration": function, "arguments": [{"value": arg} for arg in args],
        "returnByValue": True, "awaitPromise": True,
    }, timeout=timeout)
    if "exceptionDetails" in result:
        details = result["exceptionDetails"]
        raise BrowseError("the script's controller failed: " + str((details.get("exception") or {}).get("description") or details.get("text")))
    return (result.get("result") or {}).get("value")


async def install(page) -> str:
    source = CONTROLLER % {"log_limit": LOG_LIMIT, "title": json.dumps(TITLE)}
    result = await evaluate(page, source, by_value=False)
    handle = (result.get("result") or {}).get("objectId")
    if "exceptionDetails" in result or not handle:
        raise BrowseError("couldn't start the script's controller page")
    return handle


async def start(page, source: str):
    result = await evaluate(page, wrap(source))
    details = result.get("exceptionDetails")
    if not details:
        return
    exception = details.get("exception") or {}
    description = str(exception.get("description") or details.get("text") or "SyntaxError").split("\n")[0]
    line = source_line(source, details.get("lineNumber"))
    raise BrowseError(f"line {line}: {description}" if line else description, data={"line": line}, code="script_syntax")


async def answer_call(ctx, argv) -> dict:
    from ardia_cli.browse.commands import ALIASES, Ctx
    from ardia_cli.browse.daemon import run_one

    if not isinstance(argv, list) or not argv or not all(isinstance(word, str) for word in argv):
        return {"ok": False, "error": "browse() takes a command and its arguments as strings", "code": "usage"}
    name = ALIASES.get(argv[0], argv[0])
    if name in REFUSED:
        return {"ok": False, "error": f"{name} can't run inside a script", "code": "usage"}
    sub = Ctx(ctx.state, dict(ctx.options), ctx.cwd, ctx.env, None, name)
    result, error = await run_one(sub, argv)
    if isinstance(error, (OutcomeUnknown, ConnectionLost)):
        raise error
    if error is not None:
        return {"ok": False, "error": error.message, "code": error.code}
    return {"ok": True, "text": result.text, "data": json.loads(json.dumps(result.data, default=str))}


async def drive(ctx, page, handle: str, source: str, current: dict):
    await start(page, source)
    while True:
        message = await control(page, handle, "function () { return this.next(); }", timeout=MAX_TIMEOUT + 30)
        if message.get("kind") != "request":
            return message
        current.clear()
        current.update(message)
        if message.get("type") == "sleep":
            await asyncio.sleep(max(float(message.get("ms") or 0), 0) / 1000)
            answer = {"ok": True, "text": "", "data": {}}
        else:
            answer = await answer_call(ctx, message.get("argv"))
        current.clear()
        await control(page, handle, "function (id, answer) { return this.reply(id, answer); }", message["id"], answer)


def timed_out(seconds: float, current: dict, source: str, logs: list[str]) -> BrowseError:
    where = ""
    if current.get("argv"):
        where = f", in `{show_argv(current['argv'])}`"
    elif current.get("type") == "sleep":
        where = ", in sleep()"
    line = source_line(source, current.get("line"))
    if line:
        where += f" at line {line}"
    from ardia_cli.browse.commands import ALIASES, MUTATING

    name = ALIASES.get((current.get("argv") or [""])[0], (current.get("argv") or [""])[0])
    unknown = "; that command was cut off, so its outcome is unknown" if name in MUTATING else ""
    message = f"The script timed out after {seconds:g}s{where}{unknown}. Give it longer with --timeout 3m (at most 10m), or do less per run"
    return failure(message, logs, {"line": line, "command": current.get("argv")}, "timeout")


async def run(ctx, source: str, seconds: float):
    from ardia_cli.browse.commands import Result

    if not source.strip():
        raise Usage("Usage: ardia browse script [file.js] (or the script on stdin: ardia browse script <<'EOF' … EOF)")
    if len(source) > MAX_SOURCE:
        raise Usage(f"The script is over {MAX_SOURCE // 1024} KB")
    state = ctx.state
    await state.connect()
    loop = asyncio.get_running_loop()
    deadline = loop.time() + seconds
    current: dict = {}
    page = await open_controller(state)
    try:
        handle = await install(page)
        try:
            message = await asyncio.wait_for(drive(ctx, page, handle, source, current), max(deadline - loop.time(), 0.01))
        except asyncio.TimeoutError:
            logs = await saved_logs(page, handle)
            raise timed_out(seconds, current, source, logs) from None
    finally:
        cleanup = asyncio.ensure_future(close_controller(state, page.target_id))
        cancelled = False
        while not cleanup.done():
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError:
                cancelled = True
        if cancelled:
            raise asyncio.CancelledError
    logs = list(message.get("logs") or [])
    if message.get("logsDropped"):
        logs.append(f"[{message['logsDropped']} more log lines dropped past {LOG_LIMIT // 1024} KB]")
    notes = []
    if message.get("unawaited"):
        notes.append(f"[{message['unawaited']} command{'s' if message['unawaited'] != 1 else ''} the script didn't await never ran]")
    if message.get("kind") == "error":
        line = source_line(source, message.get("line"))
        text = message.get("message") or "error"
        if message.get("name") and message["name"] not in ("Error",) and not text.startswith(message["name"]):
            text = f"{message['name']}: {text}"
        where = f"line {line}: " if line else ""
        command = f" (in `{show_argv(message['command'])}`)" if message.get("command") else ""
        raise failure(f"{where}{text}{command}", logs + notes, {"line": line, "command": message.get("command")}, message.get("code"))
    value = render_value(message)
    parts = logs + ([value] if value is not None else []) + notes
    return Result({"value": None if message.get("undefined") else message.get("value"), "logs": logs},
                  "\n".join(parts) if parts else "✓ Done", page_content=True)


async def saved_logs(page, handle: str) -> list[str]:
    try:
        got = await control(page, handle, "function () { return this.logs(); }", timeout=2)
    except (BrowseError, asyncio.TimeoutError):
        return []
    return list((got or {}).get("logs") or [])
