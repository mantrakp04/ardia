import asyncio
import json
import re

from ardia_cli.browse.errors import BrowseError, ConnectionLost, OutcomeUnknown, Usage

DEFAULT_TIMEOUT = 90.0
MAX_TIMEOUT = 600.0
MAX_SOURCE = 1024 * 1024
LOG_LIMIT = 1024 * 1024
CONTROL_TIMEOUT = 5.0
SOURCE_URL = "ardia-script.js"
REFUSED = ("close", "script", "batch")
FATAL = ("outcome_unknown", "connection_lost")
TITLE = "ardia browse script"

CONTROLLER = r"""
(() => {
  if (globalThis.__ardiaScript) return globalThis.__ardiaScript;
  const LOG_LIMIT = %(log_limit)d;
  const pending = [];
  const logs = [];
  let logSize = 0;
  let logsDropped = 0;
  let wake = null;
  let finished = null;
  let worker = null;
  let ready = false;
  const signal = () => { if (wake) { const resolve = wake; wake = null; resolve(); } };
  const finish = (result) => { if (!finished) finished = result; signal(); };
  const keep = (line) => {
    if (logSize + line.length > LOG_LIMIT) { logsDropped += 1; return; }
    logs.push(line);
    logSize += line.length + 1;
  };
  const api = {
    start(source, offset) {
      worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
      worker.onmessage = (event) => {
        const message = event.data || {};
        if (message.type === "ready") ready = true;
        else if (message.type === "log") keep(String(message.line));
        else if (message.type === "request") { pending.push(message.request); signal(); }
        else if (message.type === "done") finish(message.result);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        const text = String(event.message || "error").replace(/^Uncaught /, "");
        const line = event.lineno ? Math.max(event.lineno - offset, 1) : null;
        finish({ kind: "error", message: text, name: "", line, code: ready ? null : "script_syntax" });
      };
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
      if (worker) worker.postMessage({ type: "reply", id, answer });
      return true;
    },
    stop() {
      if (worker) worker.terminate();
      worker = null;
      finish({ kind: "stopped" });
      return { logs, logsDropped };
    },
  };
  globalThis.__ardiaScript = api;
  document.title = %(title)s;
  return api;
})()
"""

WORKER = r"""const SOURCE = "ardia-script.js";
const OFFSET = %(offset)d;
const waiting = new Map();
let nextId = 1;
const show = (value) => {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  if (value instanceof Error) return value.stack || String(value);
  try { const text = JSON.stringify(value, null, 2); return text === undefined ? String(value) : text; } catch (e) { return String(value); }
};
const lineOf = (stack) => {
  const pattern = new RegExp(SOURCE.replace(/[.]/g, "\\.") + ":(\\d+):(\\d+)", "g");
  for (const match of String(stack || "").matchAll(pattern)) {
    if (Number(match[1]) > OFFSET) return Number(match[1]) - OFFSET;
  }
  return null;
};
const log = (...args) => postMessage({ type: "log", line: args.map(show).join(" ") });
const request = (kind, payload) => {
  const origin = new Error();
  const line = lineOf(origin.stack);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject, origin, argv: payload.argv });
    postMessage({ type: "request", request: { id, type: kind, line, ...payload } });
  });
};
onmessage = (event) => {
  const message = event.data || {};
  if (message.type !== "reply") return;
  const entry = waiting.get(message.id);
  if (!entry) return;
  waiting.delete(message.id);
  const answer = message.answer || {};
  if (answer.ok) { entry.resolve(answer); return; }
  const error = entry.origin;
  error.message = answer.error;
  error.code = answer.code || null;
  error.argv = entry.argv || null;
  entry.reject(error);
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
const __ardiaRun = (run) => {
  (async () => {
    let result;
    try {
      result = { kind: "done", ...clean(await run()) };
    } catch (error) {
      result = {
        kind: "error",
        message: error && error.message !== undefined ? String(error.message) : show(error),
        name: error && error.name ? String(error.name) : "Error",
        line: lineOf(error && error.stack),
        code: error && error.code ? String(error.code) : null,
        command: error && error.argv ? error.argv : null,
      };
    }
    postMessage({ type: "done", result });
  })();
};
Object.assign(self, { page, browse, read, log, sleep });
console.log = log;
console.info = log;
console.warn = log;
console.error = log;
postMessage({ type: "ready" });"""


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


def worker_source(source: str) -> tuple[str, int]:
    api = WORKER % {"offset": 0}
    offset = api.count("\n") + 2
    api = WORKER % {"offset": offset}
    return f"{api}\n__ardiaRun(async () => {{\n{source}\n}});\n//# sourceURL={SOURCE_URL}", offset


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
    from ardia_cli.redact import redact

    logs = [redact(line) for line in logs]
    body = redact(message)
    if logs:
        body += "\nlogged before that:\n" + tail(logs)
    return BrowseError(body, data={**data, "logs": logs}, code=code or "script_failed")


async def open_controller(state, owned: list[str]):
    from ardia_cli.browse import temptabs
    from ardia_cli.browse.page import Page

    target_id = await temptabs.create(state, owned)
    page = state.pages[target_id] = Page(state, target_id)
    await page.attach(state.browser)
    return page


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


async def start(page, handle: str, source: str):
    code, offset = worker_source(source)
    await control(page, handle, "function (source, offset) { return this.start(source, offset); }", code, offset)


async def answer_call(ctx, argv) -> dict:
    from ardia_cli.browse.commands import ALIASES, Ctx
    from ardia_cli.browse.daemon import run_one

    if not isinstance(argv, list) or not argv or not all(isinstance(word, str) for word in argv):
        return {"ok": False, "error": "browse() takes a command and its arguments as strings", "code": "usage"}
    name = ALIASES.get(argv[0], argv[0])
    if name == "batch":
        return {"ok": False, "error": "batch can't run inside a script; loop in the script instead", "code": "usage"}
    if name in REFUSED:
        return {"ok": False, "error": f"{name} can't run inside a script", "code": "usage"}
    sub = Ctx(ctx.state, dict(ctx.options), ctx.cwd, ctx.env, None, name)
    result, error = await run_one(sub, argv)
    if isinstance(error, (OutcomeUnknown, ConnectionLost)):
        raise error
    if error is not None:
        return {"ok": False, "error": error.message, "code": error.code}
    fatal = next((outcome for outcome in getattr(result, "batch", None) or [] if outcome.get("code") in FATAL), None)
    if fatal is not None:
        raise OutcomeUnknown(f"`{show_argv(argv)}`", fatal.get("error") or "a command inside it was cut off")
    if getattr(result, "failed", False) and name != "read":
        return {"ok": False, "error": result.text or f"{name} failed", "code": "failed"}
    return {"ok": True, "text": result.text, "data": json.loads(json.dumps(result.data, default=str))}


async def drive(ctx, page, handle: str, source: str, current: dict):
    await start(page, handle, source)
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
    from ardia_cli.browse import temptabs

    state = ctx.state
    await state.connect()
    await temptabs.sweep(state)
    current: dict = {}
    owned: list[str] = []
    try:
        page = await open_controller(state, owned)
        handle = await install(page)
        try:
            message = await asyncio.wait_for(drive(ctx, page, handle, source, current), seconds)
        except asyncio.TimeoutError:
            logs = await stopped_logs(page, handle)
            raise timed_out(seconds, current, source, logs) from None
    finally:
        await temptabs.release(state, owned)
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


async def stopped_logs(page, handle: str) -> list[str]:
    try:
        got = await control(page, handle, "function () { return this.stop(); }", timeout=CONTROL_TIMEOUT)
    except (BrowseError, asyncio.TimeoutError):
        return []
    return list((got or {}).get("logs") or [])
